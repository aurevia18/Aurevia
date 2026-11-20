import {NextResponse} from 'next/server';
import {requireUser} from '@/lib/auth';
import {db} from '@/lib/db';
import {getConfiguredSmsVerificationProvider,resolveSmsProviderReference} from '@/lib/verification-delivery';
import {getServerConfiguration} from '@/lib/config/env';

export async function GET(){
	try{
		const user=await requireUser();
		const account=await db.user.findUnique({
			where:{id:user.id},
			select:{id:true,email:true,phone:true,status:true},
		});
		if(!account||account.status!=='ACTIVE')return NextResponse.json({error:'This account is unavailable.'},{status:403});
		const records=await db.accountContactVerification.findMany({
			where:{userId:user.id},
			select:{channel:true,contact:true,verifiedAt:true,expiresAt:true,resendAfter:true,providerReference:true},
		});
		const emailRecord=records.find(record=>record.channel==='EMAIL');
		const phoneRecord=records.find(record=>record.channel==='SMS');
		const config=getServerConfiguration();
		const smsChallenge=phoneRecord?.providerReference
			?resolveSmsProviderReference(phoneRecord.providerReference)
			:null;
		const phoneDeliveryAvailable=Boolean(getConfiguredSmsVerificationProvider());
		const emailVerified=Boolean(emailRecord?.verifiedAt&&emailRecord.contact===account.email);
		const phoneVerified=Boolean(phoneRecord?.verifiedAt&&phoneRecord.contact===account.phone);
		const phonePending=Boolean(phoneRecord&&smsChallenge&&!phoneVerified&&phoneRecord.expiresAt.getTime()>Date.now());
		const emailPending=Boolean(emailRecord&&!emailVerified&&emailRecord.expiresAt.getTime()>Date.now());
		return NextResponse.json({
			email:account.email,
			emailVerified,
			emailVerifiedAt:emailVerified?emailRecord?.verifiedAt:null,
			emailPending,
			emailResendAfter:emailRecord?.resendAfter||null,
			phone:account.phone,
			phoneVerified,
			phoneVerifiedAt:phoneVerified?phoneRecord?.verifiedAt:null,
			phonePending,
			pendingPhone:phonePending?phoneRecord?.contact:null,
			phoneProvider:smsChallenge?.provider.id.toUpperCase()||null,
			phoneResendAfter:phoneRecord?.resendAfter||null,
			phoneDeliveryAvailable,
			emailDeliveryAvailable:config.email.configured,
		},{headers:{'Cache-Control':'private, no-store'}});
	}catch(error){
		if(error instanceof Error&&error.message==='UNAUTHORIZED')return NextResponse.json({error:'Sign in to manage contact verification.'},{status:401});
		if(error instanceof Error&&error.message==='FORBIDDEN')return NextResponse.json({error:'This account is unavailable.'},{status:403});
		console.error('[account-contact-verification] Status read failed.',{errorType:error instanceof Error?error.name:'UnknownError'});
		return NextResponse.json({error:'Unable to load contact verification status.'},{status:503});
	}
}
