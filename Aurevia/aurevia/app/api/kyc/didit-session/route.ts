import {createHmac,randomUUID} from 'node:crypto';
import {AccountMode,Prisma,UserStatus} from '@prisma/client';
import {NextResponse} from 'next/server';
import {requireUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {createDiditSession,DiditApiError} from '@/lib/didit';
import {getServerConfiguration} from '@/lib/config/env';
import {getTierProfileRequirements} from '@/lib/production-policy';
import {rateLimit} from '@/lib/rate-limit';

const activeFirstPartyStatuses=['DRAFT','SUBMITTED','PROCESSING','PENDING_REVIEW','NEEDS_REVIEW','RESUBMISSION_REQUIRED'] as const;

function createVendorData(userId:string,apiKey:string){
	return createHmac('sha256',apiKey).update(`aurevia-didit-v1:${userId}`).digest('hex');
}

function getCallbackUrl(applicationUrl:string){
	const origin=new URL(applicationUrl);
	if(origin.username||origin.password||origin.search||origin.hash
		||(process.env.NODE_ENV==='production'&&origin.protocol!=='https:')
		||(origin.protocol!=='https:'&&origin.hostname!=='localhost'&&origin.hostname!=='127.0.0.1')){
		throw new Error('DIDIT_CALLBACK_ORIGIN_INVALID');
	}
	return new URL('/api/kyc/didit/callback',origin.origin).toString();
}

export async function GET(){
	try{
		const user=await requireUser();
		const account=await db.user.findUnique({where:{id:user.id},select:{status:true,accountMode:true}});
		if(!account||account.status!==UserStatus.ACTIVE)return NextResponse.json({error:'This account is unavailable.'},{status:403});
		if(account.accountMode!==AccountMode.REAL)return NextResponse.json({error:'Identity verification is available in REAL mode only.'},{status:403});
		const config=getServerConfiguration().didit;
		const latestSession=await db.diditVerificationSession.findFirst({
			where:{userId:user.id},
			orderBy:{createdAt:'desc'},
			select:{sessionId:true,status:true,environment:true,createdAt:true,completedAt:true},
		});
		return NextResponse.json({
			enabled:config.enabled,
			configured:config.configured,
			environment:config.environment,
			latestSession,
		},{headers:{'Cache-Control':'private, no-store'}});
	}catch(error){
		if(error instanceof Error&&error.message==='UNAUTHORIZED')return NextResponse.json({error:'Unauthorized'},{status:401});
		if(error instanceof Error&&error.message==='FORBIDDEN')return NextResponse.json({error:'Forbidden'},{status:403});
		console.error('[didit] Verification status could not be loaded.',{errorType:error instanceof Error?error.name:'UnknownError'});
		return NextResponse.json({error:'Unable to load Didit verification status.'},{status:503,headers:{'Cache-Control':'private, no-store'}});
	}
}

export async function POST(){
	const requestId=randomUUID();
	try{
		const user=await requireUser();
		const config=getServerConfiguration().didit;
		const diditEnvironment=config.environment;
		if(!config.enabled)return NextResponse.json({error:'Didit identity verification is disabled.'},{status:503});
		if(!config.configured||!diditEnvironment)return NextResponse.json({error:'Didit identity verification is not fully configured.'},{status:503});
		rateLimit(`didit-session-user:${user.id}`,3,60*60_000);

		const account=await db.user.findUnique({
			where:{id:user.id},
			select:{id:true,name:true,country:true,phone:true,status:true,role:true,accountMode:true,approvedTier:true,kycStatus:true},
		});
		if(!account||account.status!==UserStatus.ACTIVE||account.role!=='USER')return NextResponse.json({error:'This account is unavailable.'},{status:403});
		if(account.accountMode!==AccountMode.REAL)return NextResponse.json({error:'Identity verification is available in REAL mode only.'},{status:403});
		if(account.approvedTier>=3||account.kycStatus==='APPROVED')return NextResponse.json({error:'Your identity verification is already approved.'},{status:409});
		if(!getTierProfileRequirements(account).profileComplete)return NextResponse.json({error:'Complete your name and country in Profile before starting identity verification.'},{status:409});
		const latestFirstPartyCase=await db.kycVerification.findFirst({
			where:{userId:user.id},
			orderBy:{createdAt:'desc'},
			select:{status:true},
		});
		if(latestFirstPartyCase&&activeFirstPartyStatuses.includes(latestFirstPartyCase.status as typeof activeFirstPartyStatuses[number])){
			return NextResponse.json({error:'A first-party identity verification case is already active. Continue or resolve that case before starting Didit verification.'},{status:409});
		}

		let callback:string;
		try{callback=getCallbackUrl(getServerConfiguration().app.url)}
		catch{return NextResponse.json({error:'The application HTTPS callback URL is not configured for Didit.'},{status:503})}

		const vendorData=createVendorData(user.id,config.apiKey);
		const providerSession=await createDiditSession({vendorData,callback});
		await db.$transaction(async tx=>{
			const currentUser=await tx.user.findUnique({
				where:{id:user.id},
				select:{id:true,status:true,role:true,accountMode:true,approvedTier:true,kycStatus:true},
			});
			if(!currentUser||currentUser.status!=='ACTIVE'||currentUser.role!=='USER'||currentUser.accountMode!=='REAL'
				||currentUser.approvedTier>=3||currentUser.kycStatus==='APPROVED'){
				throw new Error('DIDIT_ACCOUNT_NOT_ELIGIBLE');
			}
			const latestCase=await tx.kycVerification.findFirst({
				where:{userId:user.id},
				orderBy:{createdAt:'desc'},
				select:{status:true},
			});
			if(latestCase&&activeFirstPartyStatuses.includes(latestCase.status as typeof activeFirstPartyStatuses[number])){
				throw new Error('DIDIT_FIRST_PARTY_CASE_ACTIVE');
			}
			const existing=await tx.diditVerificationSession.findUnique({
				where:{sessionId:providerSession.sessionId},
				select:{id:true,userId:true,workflowId:true,vendorData:true,environment:true},
			});
			if(existing){
				if(existing.userId!==user.id||existing.workflowId!==providerSession.workflowId
					||existing.vendorData!==providerSession.vendorData||existing.environment!==diditEnvironment){
					throw new Error('DIDIT_SESSION_ASSOCIATION_CONFLICT');
				}
			}else{
				await tx.diditVerificationSession.create({data:{
					userId:user.id,
					sessionId:providerSession.sessionId,
					workflowId:providerSession.workflowId,
					vendorData:providerSession.vendorData,
					status:providerSession.status,
					environment:diditEnvironment,
					decision:{status:providerSession.status},
				}});
			}
			const updated=await tx.user.updateMany({
				where:{id:user.id,status:'ACTIVE',role:'USER',accountMode:'REAL',kycStatus:{not:'APPROVED'}},
				data:{kycStatus:'PENDING'},
			});
			if(updated.count!==1)throw new Error('DIDIT_ACCOUNT_NOT_ELIGIBLE');
		},{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});

		return NextResponse.json({
			sessionId:providerSession.sessionId,
			status:providerSession.status,
			url:providerSession.url,
			expiresAt:providerSession.expiresAt,
		},{status:201,headers:{'Cache-Control':'private, no-store'}});
	}catch(error){
		if(error instanceof Error&&error.message==='UNAUTHORIZED')return NextResponse.json({error:'Sign in to start identity verification.'},{status:401});
		if(error instanceof Error&&error.message==='FORBIDDEN')return NextResponse.json({error:'This account is unavailable.'},{status:403});
		if(error instanceof Error&&error.message==='RATE_LIMITED')return NextResponse.json({error:'Too many verification attempts. Try again later.'},{status:429});
		if(error instanceof Error&&['DIDIT_ACCOUNT_NOT_ELIGIBLE','DIDIT_FIRST_PARTY_CASE_ACTIVE','DIDIT_SESSION_ASSOCIATION_CONFLICT'].includes(error.message)){
			const status=error.message==='DIDIT_FIRST_PARTY_CASE_ACTIVE'?409:error.message==='DIDIT_SESSION_ASSOCIATION_CONFLICT'?503:409;
			return NextResponse.json({error:'This identity verification request is no longer eligible. Refresh the verification page.'},{status});
		}
		if(error instanceof DiditApiError){
			console.error('[didit] Session creation failed.',{
				requestId,
				failureStage:error.failureStage,
				httpStatus:error.httpStatus,
				errorType:error.underlyingErrorType,
			});
			return NextResponse.json({error:'Didit could not start identity verification. Try again later.'},{status:error.failureStage==='configuration'?503:502});
		}
		if(error instanceof Prisma.PrismaClientKnownRequestError&&['P2002','P2034'].includes(error.code)){
			return NextResponse.json({error:'The verification session changed while being created. Refresh and try again.'},{status:409});
		}
		console.error('[didit] Session creation failed.',{requestId,errorType:error instanceof Error?error.name:'UnknownError'});
		return NextResponse.json({error:'Unable to start identity verification.'},{status:503});
	}
}
