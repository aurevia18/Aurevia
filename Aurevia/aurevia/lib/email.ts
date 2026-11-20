import {getServerConfiguration} from './config/env';
import {renderAureviaEmail} from './email-template';

export type EmailProvider='brevo'|'none';
export type EmailFailureReason='not-configured'|'failed'|'timeout'|'network-error'|'provider-rejected';
export type EmailDelivery={
	sent:boolean;
	reason?:EmailFailureReason;
	provider?:EmailProvider;
	httpStatus?:number;
	providerCode?:string;
};
export type EmailDeliveryStatus='sent'|'not-configured'|'failed';

export function emailDeliveryStatus(delivery:EmailDelivery):EmailDeliveryStatus{
	if(delivery.sent)return 'sent';
	return delivery.reason==='not-configured'?'not-configured':'failed';
}

function safeProviderCode(value:unknown){
	if(typeof value!=='object'||value===null||Array.isArray(value))return undefined;
	const record=value as Record<string,unknown>;
	const nested=typeof record.error==='object'&&record.error!==null&&!Array.isArray(record.error)
		?record.error as Record<string,unknown>
		:null;
	const candidate=record.code??record.errorCode??record.error_code
		??nested?.code??nested?.errorCode??nested?.error_code;
	return typeof candidate==='string'&&/^[A-Za-z][A-Za-z0-9_.-]{1,63}$/.test(candidate)
		?candidate.toUpperCase()
		:undefined;
}

export function isEmailConfigured(){
	return getServerConfiguration().email.configured;
}

export async function sendEmail(input:{to:string;subject:string;text:string;html?:string}):Promise<EmailDelivery>{
	const config=getServerConfiguration().email;
	if(!config.configured)return {sent:false,provider:'none',reason:'not-configured'};

	const subject=input.subject.replace(/[\r\n]+/g,' ').slice(0,200);
	const html=input.html||renderAureviaEmail({
		title:subject,
		paragraphs:input.text.split(/\n{2,}/),
	});

	try{
		const response=await fetch('https://api.brevo.com/v3/smtp/email',{
			method:'POST',
			headers:{
				accept:'application/json',
				'api-key':config.brevoApiKey,
				'content-type':'application/json',
			},
			body:JSON.stringify({
				sender:{email:config.senderEmail,name:config.senderName},
				to:[{email:input.to}],
				subject,
				textContent:input.text,
				htmlContent:html,
			}),
			signal:AbortSignal.timeout(8_000),
			redirect:'error',
			cache:'no-store',
		});
		if(!response.ok){
			const result=await response.clone().json().catch(()=>null) as unknown;
			console.error('Brevo transactional email delivery failed.',{
				httpStatus:response.status,
				...(safeProviderCode(result)?{providerCode:safeProviderCode(result)}:{}),
			});
			return {
				sent:false,
				provider:'brevo',
				reason:'provider-rejected',
				httpStatus:response.status,
				...(safeProviderCode(result)?{providerCode:safeProviderCode(result)}:{}),
			};
		}
		return {sent:true,provider:'brevo'};
	}catch(error){
		const timedOut=error instanceof Error&&error.name==='TimeoutError';
		const reason=timedOut?'timeout':'network-error';
		console.error('Brevo transactional email delivery failed.',{
			reason,
			errorType:error instanceof Error?error.name:'UnknownError',
		});
		return {sent:false,provider:'brevo',reason};
	}
}

export function sendSupportEmail(subject:string,text:string){
	const recipient=getServerConfiguration().support.supportEmail;
	if(!recipient){console.warn('Support email was not sent: SUPPORT_EMAIL is not configured.');return Promise.resolve<EmailDelivery>({sent:false,reason:'not-configured'});}
	return sendEmail({to:recipient,subject,text});
}

export function sendComplaintEmail(subject:string,text:string){
	const recipient=getServerConfiguration().support.complaintsEmail;
	if(!recipient){console.warn('Complaint email was not sent: COMPLAINTS_EMAIL is not configured.');return Promise.resolve<EmailDelivery>({sent:false,reason:'not-configured'});}
	return sendEmail({to:recipient,subject,text});
}
