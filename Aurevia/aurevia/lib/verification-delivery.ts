import {randomInt,createHmac,timingSafeEqual} from 'node:crypto';
import {verificationConfig} from './config';
import {getServerConfiguration} from './config/env';

export type SmsVerificationProviderId='termii';
export type SmsVerificationProvider={
	id:SmsVerificationProviderId;
	send(phone:string):Promise<string>;
	verify(reference:string,code:string):Promise<boolean>;
};

export function hasConfiguredTermii(){
	return getServerConfiguration().verification.termiiConfigured;
}

export function getConfiguredSmsVerificationProvider():SmsVerificationProvider|null{
	return hasConfiguredTermii()?termiiProvider:null;
}

export function formatSmsProviderReference(provider:SmsVerificationProvider,reference:string){
	return `${provider.id.toUpperCase()}:${reference}`;
}

export function resolveSmsProviderReference(value:string):{provider:SmsVerificationProvider;reference:string}|null{
	if(value.startsWith('TERMII:')){
		const reference=value.slice('TERMII:'.length);
		return reference?{provider:termiiProvider,reference}:null;
	}
	if(!value||value.includes(':')||value==='TWILIO')return null;
	return {provider:termiiProvider,reference:value};
}

export function generateVerificationCode(){
	return randomInt(100000,1000000).toString();
}

export function hashVerificationCode(userId:string,code:string){
	const secret=getServerConfiguration().verification.codeSecret;
	if(!secret)throw new Error('VERIFICATION_SECRET_UNAVAILABLE');
	return createHmac('sha256',secret).update(`${userId}:${code}`).digest('hex');
}

export function verificationCodeMatches(userId:string,code:string,hash:string){
	const actual=Buffer.from(hashVerificationCode(userId,code),'hex');
	const expected=Buffer.from(hash,'hex');
	return actual.length===expected.length&&timingSafeEqual(actual,expected);
}

export class TermiiProviderError extends Error{
	constructor(
		message:'PHONE_VERIFICATION_PROVIDER_UNAVAILABLE'|'PHONE_VERIFICATION_PROVIDER_FAILED',
		readonly failureStage:'transport'|'provider_response'|'invalid_response',
		readonly httpStatus:number|null,
		readonly underlyingErrorType:string|null=null,
	){
		super(message);
		this.name='TermiiProviderError';
	}
}

export async function sendTermiiVerificationToken(phone:string){
	const config=getServerConfiguration().verification;
	if(!config.termiiConfigured)throw new Error('PHONE_VERIFICATION_DELIVERY_UNAVAILABLE');
	let response:Response;
	try{
		response=await fetch(`${config.termiiBaseUrl}/api/sms/otp/send`,{
			method:'POST',
			headers:{'content-type':'application/json'},
			body:JSON.stringify({
				api_key:config.termiiApiKey,
				message_type:'NUMERIC',
				to:phone,
				from:config.termiiSenderId,
				channel:'generic',
				pin_attempts:verificationConfig.maxAttempts,
				pin_time_to_live:verificationConfig.expiresInMinutes,
				pin_length:6,
				pin_type:'NUMERIC',
				pin_placeholder:'< 123456 >',
				message:'Your Aurevia Exchange phone verification code is < 123456 >.',
			}),
			signal:AbortSignal.timeout(8000),
			redirect:'error',
		});
	}catch(error){
		throw new TermiiProviderError('PHONE_VERIFICATION_PROVIDER_UNAVAILABLE','transport',null,error instanceof Error?error.name:'UnknownError');
	}
	const result=await response.json().catch(()=>null) as {pin_id?:unknown}|null;
	if(!response.ok)throw new TermiiProviderError('PHONE_VERIFICATION_PROVIDER_FAILED','provider_response',response.status);
	if(typeof result?.pin_id!=='string'||!result.pin_id)throw new TermiiProviderError('PHONE_VERIFICATION_PROVIDER_FAILED','invalid_response',response.status);
	return result.pin_id;
}

export async function verifyTermiiVerificationToken(pinId:string,code:string){
	const config=getServerConfiguration().verification;
	if(!config.termiiConfigured)throw new Error('PHONE_VERIFICATION_DELIVERY_UNAVAILABLE');
	let response:Response;
	try{
		response=await fetch(`${config.termiiBaseUrl}/api/sms/otp/verify`,{
			method:'POST',
			headers:{'content-type':'application/json'},
			body:JSON.stringify({api_key:config.termiiApiKey,pin_id:pinId,pin:code}),
			signal:AbortSignal.timeout(8000),
			redirect:'error',
		});
	}catch(error){
		throw new TermiiProviderError('PHONE_VERIFICATION_PROVIDER_UNAVAILABLE','transport',null,error instanceof Error?error.name:'UnknownError');
	}
	const result=await response.json().catch(()=>null) as {verified?:unknown}|null;
	if(!response.ok)throw new TermiiProviderError('PHONE_VERIFICATION_PROVIDER_FAILED','provider_response',response.status);
	if(!result||!['true','false'].includes(String(result.verified).toLowerCase())){
		throw new TermiiProviderError('PHONE_VERIFICATION_PROVIDER_FAILED','invalid_response',response.status);
	}
	return String(result.verified).toLowerCase()==='true';
}

const termiiProvider:SmsVerificationProvider={
	id:'termii',
	send:sendTermiiVerificationToken,
	verify:(_reference,code)=>verifyTermiiVerificationToken(_reference,code),
};
