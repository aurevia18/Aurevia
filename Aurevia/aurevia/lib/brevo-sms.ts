import {getServerConfiguration} from '@/lib/config/env';

export class BrevoSmsDeliveryError extends Error{
	constructor(
		readonly failureStage:'configuration'|'transport'|'provider_response'|'invalid_response',
		readonly httpStatus:number|null,
		readonly providerCode:string|null=null,
		readonly underlyingErrorType:string|null=null,
	){
		super('SMS_DELIVERY_FAILED');
		this.name='BrevoSmsDeliveryError';
	}
}

function safeProviderCode(value:unknown){
	if(typeof value!=='object'||value===null||Array.isArray(value))return null;
	const code=(value as Record<string,unknown>).code;
	return typeof code==='string'&&/^[A-Za-z][A-Za-z0-9_.-]{1,63}$/.test(code)
		?code.toUpperCase()
		:null;
}

export async function sendBrevoTransactionalSms(recipient:string,content:string){
	const config=getServerConfiguration().email;
	const sender=config.senderName;
	if(!config.brevoApiKey||!sender||!/^[A-Za-z0-9]{1,11}$/.test(sender)){
		throw new BrevoSmsDeliveryError('configuration',null);
	}
	let response:Response;
	try{
		response=await fetch('https://api.brevo.com/v3/transactionalSMS/sms',{
			method:'POST',
			headers:{
				accept:'application/json',
				'api-key':config.brevoApiKey,
				'content-type':'application/json',
			},
			body:JSON.stringify({
				sender,
				recipient,
				content,
				type:'transactional',
				tag:'withdrawal-approval',
			}),
			signal:AbortSignal.timeout(8_000),
			redirect:'error',
			cache:'no-store',
		});
	}catch(error){
		throw new BrevoSmsDeliveryError(
			'transport',
			null,
			null,
			error instanceof Error?error.name:'UnknownError',
		);
	}
	const result=await response.json().catch(()=>null) as {messageId?:unknown}|null;
	if(!response.ok){
		throw new BrevoSmsDeliveryError('provider_response',response.status,safeProviderCode(result));
	}
	const messageId=typeof result?.messageId==='number'||typeof result?.messageId==='string'
		?String(result.messageId)
		:'';
	if(!messageId||messageId.length>180){
		throw new BrevoSmsDeliveryError('invalid_response',response.status);
	}
	return messageId;
}
