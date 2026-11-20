import {NextResponse} from 'next/server';
import {requireUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {getServerConfiguration} from '@/lib/config/env';

const sessionIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request:Request){
	const sessionId=new URL(request.url).searchParams.get('verificationSessionId')||'';
	if(!sessionIdPattern.test(sessionId))return NextResponse.json({error:'Verification session not found.'},{status:404});
	try{
		const user=await requireUser();
		const ownedSession=await db.diditVerificationSession.findFirst({
			where:{sessionId,userId:user.id},
			select:{id:true},
		});
		if(!ownedSession)return NextResponse.json({error:'Verification session not found.'},{status:404});
		const appUrl=getServerConfiguration().app.url;
		if(!appUrl)return NextResponse.json({error:'Application callback URL is not configured.'},{status:503});
		return NextResponse.redirect(new URL('/kyc',appUrl),303);
	}catch(error){
		if(error instanceof Error&&error.message==='UNAUTHORIZED'){
			const appUrl=getServerConfiguration().app.url;
			if(!appUrl)return NextResponse.json({error:'Application callback URL is not configured.'},{status:503});
			return NextResponse.redirect(new URL('/login?callbackUrl=%2Fkyc',appUrl),303);
		}
		if(error instanceof Error&&error.message==='FORBIDDEN')return NextResponse.json({error:'Verification session not found.'},{status:404});
		console.error('[didit] Verification callback could not be resolved.',{errorType:error instanceof Error?error.name:'UnknownError'});
		return NextResponse.json({error:'Unable to return to identity verification.'},{status:503});
	}
}
