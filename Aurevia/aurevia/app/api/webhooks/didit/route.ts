import {AccountMode,Prisma,UserStatus} from '@prisma/client';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/db';
import {
	diditEnvironmentWebhookValue,
	DiditApiError,
	isDiditTerminalStatus,
	parseAndVerifyDiditWebhook,
	toLocalKycStatus,
} from '@/lib/didit';
import {getServerConfiguration} from '@/lib/config/env';

const maxWebhookBytes=1024*1024;
const statusSchema=z.enum([
	'Approved',
	'Declined',
	'In Review',
	'In Progress',
	'Not Started',
	'Expired',
	'Abandoned',
	'Kyc Expired',
	'Resubmitted',
	'Awaiting User',
]);
const statusEventSchema=z.object({
	event_id:z.string().uuid(),
	session_id:z.string().uuid(),
	webhook_type:z.literal('status.updated'),
	timestamp:z.number().int().positive(),
	created_at:z.number().int().positive(),
	environment:z.enum(['sandbox','live']),
	session_kind:z.enum(['user','business']).optional(),
	workflow_id:z.string().uuid(),
	vendor_data:z.string().min(1).max(255),
	status:statusSchema,
});

async function readBoundedBody(request:Request){
	const declaredLength=request.headers.get('content-length');
	if(declaredLength!==null){
		const length=Number(declaredLength);
		if(!Number.isSafeInteger(length)||length<0)throw new Error('DIDIT_WEBHOOK_BODY_INVALID');
		if(length>maxWebhookBytes)throw new Error('DIDIT_WEBHOOK_TOO_LARGE');
	}
	if(!request.body)throw new Error('DIDIT_WEBHOOK_BODY_INVALID');
	const reader=request.body.getReader();
	const chunks:Uint8Array[]=[];
	let size=0;
	while(true){
		const {done,value}=await reader.read();
		if(done)break;
		size+=value.byteLength;
		if(size>maxWebhookBytes){
			await reader.cancel();
			throw new Error('DIDIT_WEBHOOK_TOO_LARGE');
		}
		chunks.push(value);
	}
	try{return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))}
	catch{throw new Error('DIDIT_WEBHOOK_BODY_INVALID')}
}

function isDuplicateEvent(error:unknown){
	return error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002';
}

export async function POST(request:Request){
	const config=getServerConfiguration().didit;
	if(!config.enabled)return NextResponse.json({error:'Didit webhook is disabled.'},{status:410});
	if(!config.configured)return NextResponse.json({error:'Didit webhook is not configured.'},{status:503});

	let rawBody:string;
	try{rawBody=await readBoundedBody(request)}
	catch(error){
		const tooLarge=error instanceof Error&&error.message==='DIDIT_WEBHOOK_TOO_LARGE';
		if(!tooLarge)console.warn('[didit] Webhook body was invalid.',{errorType:error instanceof Error?error.name:'UnknownError'});
		return NextResponse.json({error:tooLarge?'Webhook payload is too large.':'Webhook payload could not be read.'},{status:tooLarge?413:400});
	}

	let payload:Record<string,unknown>;
	try{payload=parseAndVerifyDiditWebhook(rawBody,request.headers)}
	catch(error){
		if(error instanceof DiditApiError&&error.failureStage==='configuration'){
			console.error('[didit] Webhook verification is unavailable because its signing secret is not configured.');
			return NextResponse.json({error:'Webhook verification is not configured.'},{status:503});
		}
		console.warn('[didit] Webhook signature or timestamp was rejected.');
		return NextResponse.json({error:'Webhook signature or timestamp is invalid.'},{status:401});
	}

	if(payload.webhook_type!=='status.updated')return NextResponse.json({received:true});
	const parsedEvent=statusEventSchema.safeParse(payload);
	if(!parsedEvent.success)return NextResponse.json({error:'Webhook event is invalid.'},{status:400});
	const event=parsedEvent.data;
	if(event.session_kind==='business')return NextResponse.json({received:true});
	const expectedEnvironment=config.environment
		?diditEnvironmentWebhookValue(config.environment)
		:null;
	if(!expectedEnvironment||event.environment!==expectedEnvironment)return NextResponse.json({received:true});

	const session=await db.diditVerificationSession.findUnique({
		where:{sessionId:event.session_id},
		select:{id:true,userId:true,workflowId:true,vendorData:true,environment:true,createdAt:true},
	});
	if(!session){
		console.warn('[didit] Signed status event does not match a persisted session.');
		return NextResponse.json({error:'Verification session is not available yet.'},{status:503});
	}
	if(session.workflowId!==event.workflow_id||session.vendorData!==event.vendor_data
		||session.environment!==config.environment){
		console.warn('[didit] Signed status event does not match the stored session configuration.');
		return NextResponse.json({received:true});
	}

	const eventCreatedAt=new Date(event.created_at*1000);
	if(!Number.isFinite(eventCreatedAt.getTime()))return NextResponse.json({error:'Webhook event time is invalid.'},{status:400});
	try{
		await db.$transaction(async tx=>{
			await tx.diditWebhookEvent.create({data:{
				eventId:event.event_id,
				sessionId:event.session_id,
				webhookType:event.webhook_type,
				createdAt:eventCreatedAt,
			}});
			const current=await tx.diditVerificationSession.findUnique({
				where:{sessionId:event.session_id},
				select:{id:true,userId:true,lastEventAt:true,createdAt:true},
			});
			if(!current)throw new Error('DIDIT_SESSION_DISAPPEARED');
			if(current.lastEventAt&&eventCreatedAt<=current.lastEventAt)return;

			const updated=await tx.diditVerificationSession.updateMany({
				where:{id:current.id,lastEventAt:current.lastEventAt},
				data:{
					status:event.status,
					decision:{status:event.status},
					lastEventAt:eventCreatedAt,
					completedAt:isDiditTerminalStatus(event.status)?eventCreatedAt:null,
				},
			});
			if(updated.count!==1)throw new Error('DIDIT_SESSION_CHANGED');

			const [latestSession,newerFirstPartyCase,account]=await Promise.all([
				tx.diditVerificationSession.findFirst({
					where:{userId:current.userId},
					orderBy:{createdAt:'desc'},
					select:{id:true},
				}),
				tx.kycVerification.findFirst({
					where:{userId:current.userId,status:{not:'CANCELLED'},createdAt:{gte:current.createdAt}},
					select:{id:true},
				}),
				tx.user.findUnique({
					where:{id:current.userId},
					select:{status:true,role:true,accountMode:true},
				}),
			]);
			if(latestSession?.id===current.id&&!newerFirstPartyCase
				&&account?.status===UserStatus.ACTIVE&&account.role==='USER'&&account.accountMode===AccountMode.REAL){
				await tx.user.updateMany({
					where:{id:current.userId,status:'ACTIVE',role:'USER',accountMode:'REAL'},
					data:{kycStatus:toLocalKycStatus(event.status)},
				});
			}
		},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
		return NextResponse.json({received:true});
	}catch(error){
		if(isDuplicateEvent(error))return NextResponse.json({received:true,duplicate:true});
		if(error instanceof Error&&error.message==='DIDIT_SESSION_DISAPPEARED'){
			return NextResponse.json({error:'Verification session is not available yet.'},{status:503});
		}
		if(error instanceof Error&&error.message==='DIDIT_SESSION_CHANGED'){
			return NextResponse.json({error:'Verification session changed while processing.'},{status:503});
		}
		console.error('[didit] Signed status event could not be processed.',{
			errorType:error instanceof Error?error.name:'UnknownError',
			...(error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'?{databaseCode:error.code}:{}),
		});
		return NextResponse.json({error:'Webhook event could not be processed.'},{status:503});
	}
}
