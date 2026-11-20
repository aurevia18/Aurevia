import {NextResponse} from 'next/server';
import {z,ZodError} from 'zod';
import {requireAdmin} from '@/lib/auth';
import {db} from '@/lib/db';

const querySchema=z.object({page:z.coerce.number().int().min(1).default(1)});
const pageSize=25;

export async function GET(request:Request){
	try{
		const admin=await requireAdmin();
		const input=querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
		const [items,total]=await Promise.all([
			db.diditVerificationSession.findMany({
				skip:(input.page-1)*pageSize,
				take:pageSize,
				orderBy:{createdAt:'desc'},
				select:{
					id:true,sessionId:true,workflowId:true,status:true,environment:true,lastEventAt:true,completedAt:true,createdAt:true,
					user:{select:{id:true,name:true,email:true,accountMode:true,status:true}},
				},
			}),
			db.diditVerificationSession.count(),
		]);
		const eventRows=items.flatMap(item=>item.sessionId?[item.sessionId]:[]);
		const events=eventRows.length?await db.diditWebhookEvent.findMany({
			where:{sessionId:{in:eventRows}},
			orderBy:{createdAt:'desc'},
			take:pageSize*5,
			select:{eventId:true,sessionId:true,webhookType:true,createdAt:true,receivedAt:true},
		}):[];
		const eventsBySession=new Map<string,typeof events>();
		for(const event of events){
			const current=eventsBySession.get(event.sessionId)||[];
			if(current.length<5)current.push(event);
			eventsBySession.set(event.sessionId,current);
		}
		await db.auditLog.create({data:{
			actorId:admin.id,
			action:'DIDIT_KYC_SESSIONS_ACCESSED',
			entity:'KYC',
			metadata:{page:input.page,resultCount:items.length},
		}});
		return NextResponse.json({
			items:items.map(({user,...item})=>({
				...item,
				user:{id:user.id,name:user.name,email:user.email,accountMode:user.accountMode,status:user.status},
				events:item.sessionId?eventsBySession.get(item.sessionId)||[]:[],
			})),
			total,
			page:input.page,
			pageSize,
			totalPages:Math.ceil(total/pageSize),
		},{headers:{'Cache-Control':'private, no-store'}});
	}catch(error){
		if(error instanceof Error&&error.message==='UNAUTHORIZED')return NextResponse.json({error:'Unauthorized'},{status:401});
		if(error instanceof Error&&error.message==='FORBIDDEN')return NextResponse.json({error:'Forbidden'},{status:403});
		if(error instanceof ZodError)return NextResponse.json({error:'Invalid Didit session page.'},{status:400});
		console.error('Administrator Didit KYC sessions could not be loaded.',{errorType:error instanceof Error?error.name:'UnknownError'});
		return NextResponse.json({error:'Unable to load Didit KYC sessions.'},{status:503,headers:{'Cache-Control':'private, no-store'}});
	}
}
