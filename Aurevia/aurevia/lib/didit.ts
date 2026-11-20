import {createHmac,timingSafeEqual} from 'node:crypto';
import {getServerConfiguration} from '@/lib/config/env';

const DIDIT_API_BASE='https://verification.didit.me';
const DIDIT_SESSION_URL_ORIGIN='https://verify.didit.me';
const diditStatuses=[
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
] as const;

export type DiditStatus=typeof diditStatuses[number];
export type DiditSessionResponse={
	sessionId:string;
	url:string;
	expiresAt:Date;
	status:DiditStatus;
	workflowId:string;
	vendorData:string;
};

export class DiditApiError extends Error{
	constructor(
		readonly failureStage:'configuration'|'transport'|'provider_response'|'invalid_response',
		readonly httpStatus:number|null=null,
		readonly underlyingErrorType:string|null=null,
	){
		super('DIDIT_REQUEST_FAILED');
		this.name='DiditApiError';
	}
}

function isRecord(value:unknown):value is Record<string,unknown>{
	return typeof value==='object'&&value!==null&&!Array.isArray(value);
}

function isDiditStatus(value:unknown):value is DiditStatus{
	return typeof value==='string'&&diditStatuses.includes(value as DiditStatus);
}

export async function createDiditSession(input:{vendorData:string;callback:string}):Promise<DiditSessionResponse>{
	const config=getServerConfiguration().didit;
	if(!config.configured||!config.environment)throw new DiditApiError('configuration');

	let response:Response;
	try{
		response=await fetch(`${DIDIT_API_BASE}/v3/session/`,{
			method:'POST',
			headers:{
				accept:'application/json',
				'x-api-key':config.apiKey,
				'content-type':'application/json',
			},
			body:JSON.stringify({
				workflow_id:config.workflowId,
				vendor_data:input.vendorData,
				callback:input.callback,
				callback_method:'both',
			}),
			signal:AbortSignal.timeout(10_000),
			redirect:'error',
			cache:'no-store',
		});
	}catch(error){
		throw new DiditApiError(
			'transport',
			null,
			error instanceof Error?error.name:'UnknownError',
		);
	}
	if(!response.ok)throw new DiditApiError('provider_response',response.status);

	const result=await response.json().catch(()=>null) as unknown;
	if(!isRecord(result))throw new DiditApiError('invalid_response',response.status);
	const sessionId=result.session_id;
	const urlValue=result.url;
	const expiresAtValue=result.expires_at;
	const workflowId=result.workflow_id;
	const vendorData=result.vendor_data;
	if(typeof sessionId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)
		||result.session_kind!=='user'
		||!isDiditStatus(result.status)
		||workflowId!==config.workflowId
		||vendorData!==input.vendorData
		||typeof urlValue!=='string'
		||typeof expiresAtValue!=='string'){
		throw new DiditApiError('invalid_response',response.status);
	}
	let url:URL;
	const expiresAt=new Date(expiresAtValue);
	try{url=new URL(urlValue)}catch{throw new DiditApiError('invalid_response',response.status)}
	if(url.origin!==DIDIT_SESSION_URL_ORIGIN||url.protocol!=='https:'||url.username||url.password||!Number.isFinite(expiresAt.getTime())){
		throw new DiditApiError('invalid_response',response.status);
	}
	return {sessionId,url:url.toString(),expiresAt,status:result.status,workflowId,vendorData};
}

function sortedJson(value:unknown):unknown{
	if(Array.isArray(value))return value.map(sortedJson);
	if(isRecord(value))return Object.fromEntries(
		Object.keys(value).sort().map(key=>[key,sortedJson(value[key])]),
	);
	return value;
}

export function canonicalizeDiditPayload(value:unknown){
	return JSON.stringify(sortedJson(value));
}

export function parseAndVerifyDiditWebhook(
	rawBody:string,
	headers:Headers,
	now=Date.now(),
):Record<string,unknown>{
	const config=getServerConfiguration().didit;
	if(!config.enabled||!config.webhookSecret)throw new DiditApiError('configuration');

	const timestampHeader=headers.get('x-timestamp')||'';
	const signature=headers.get('x-signature-v2')||'';
	if(!/^\d{1,12}$/.test(timestampHeader)||!/^[0-9a-f]{64}$/i.test(signature)){
		throw new DiditApiError('invalid_response');
	}
	const timestamp=Number(timestampHeader);
	if(!Number.isSafeInteger(timestamp)||Math.abs(Math.floor(now/1000)-timestamp)>300){
		throw new DiditApiError('invalid_response');
	}
	let payload:unknown;
	try{payload=JSON.parse(rawBody)}catch{throw new DiditApiError('invalid_response')}
	if(!isRecord(payload)||payload.timestamp!==timestamp)throw new DiditApiError('invalid_response');

	const expected=Buffer.from(
		createHmac('sha256',config.webhookSecret).update(canonicalizeDiditPayload(payload),'utf8').digest('hex'),
		'hex',
	);
	const actual=Buffer.from(signature,'hex');
	if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){
		throw new DiditApiError('invalid_response');
	}
	return payload;
}

export function diditEnvironmentWebhookValue(environment:'sandbox'|'production'){
	return environment==='sandbox'?'sandbox':'live';
}

export function isDiditTerminalStatus(status:DiditStatus){
	return ['Approved','Declined','Expired','Abandoned','Kyc Expired'].includes(status);
}

export function toLocalKycStatus(status:DiditStatus):'PENDING'|'APPROVED'|'REJECTED'{
	if(status==='Approved')return 'APPROVED';
	if(status==='Declined')return 'REJECTED';
	return 'PENDING';
}
