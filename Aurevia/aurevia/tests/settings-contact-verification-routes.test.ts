import {beforeEach,describe,expect,it,vi} from 'vitest';

const state=vi.hoisted(()=>({
	user:{
		id:'user-1',
		email:'person@example.invalid',
		phone:null as string|null,
		status:'ACTIVE',
		role:'USER',
		accountMode:'DEMO',
	},
	challenge:null as Record<string,unknown>|null,
	audit:[] as Record<string,unknown>[],
	emailText:'',
}));

const mocks=vi.hoisted(()=>({
	requireUser:vi.fn(),
	userFindUnique:vi.fn(),
	userFindFirst:vi.fn(),
	userUpdateMany:vi.fn(),
	verificationFindUnique:vi.fn(),
	verificationFindFirst:vi.fn(),
	verificationFindMany:vi.fn(),
	verificationCreate:vi.fn(),
	verificationUpdateMany:vi.fn(),
	verificationDeleteMany:vi.fn(),
	auditCreate:vi.fn(),
	transaction:vi.fn(),
	isEmailConfigured:vi.fn(),
	sendEmail:vi.fn(),
	getSmsProvider:vi.fn(),
	formatSmsProviderReference:vi.fn(),
	resolveSmsProviderReference:vi.fn(),
	sendTermii:vi.fn(),
	verifyTermii:vi.fn(),
	rateLimit:vi.fn(),
}));

vi.mock('@/lib/auth',()=>({requireUser:mocks.requireUser}));
vi.mock('@/lib/config/env',()=>({
	getServerConfiguration:()=>({
		verification:{
			codeSecret:'test-code-secret',
			termiiConfigured:true,
		},
		email:{configured:true},
	}),
}));
vi.mock('@/lib/db',()=>({db:{
	user:{findUnique:mocks.userFindUnique,findFirst:mocks.userFindFirst,updateMany:mocks.userUpdateMany},
	accountContactVerification:{
		findUnique:mocks.verificationFindUnique,
		findFirst:mocks.verificationFindFirst,
		findMany:mocks.verificationFindMany,
		create:mocks.verificationCreate,
		updateMany:mocks.verificationUpdateMany,
		deleteMany:mocks.verificationDeleteMany,
	},
	auditLog:{create:mocks.auditCreate},
	$transaction:mocks.transaction,
}}));
vi.mock('@/lib/email',()=>({
	isEmailConfigured:mocks.isEmailConfigured,
	sendEmail:mocks.sendEmail,
}));
vi.mock('@/lib/verification-delivery',()=>({
	getConfiguredSmsVerificationProvider:mocks.getSmsProvider,
	formatSmsProviderReference:mocks.formatSmsProviderReference,
	resolveSmsProviderReference:mocks.resolveSmsProviderReference,
	TermiiProviderError:class TermiiProviderError extends Error{},
}));
vi.mock('@/lib/request-ip',()=>({trustedProxyClientIp:()=> '127.0.0.1'}));
vi.mock('@/lib/rate-limit',()=>({rateLimit:mocks.rateLimit}));

import {POST as sendEmailCode} from '@/app/api/settings/email-verification/send/route';
import {POST as verifyEmailCode} from '@/app/api/settings/email-verification/verify/route';
import {POST as sendPhoneCode} from '@/app/api/settings/phone-verification/send/route';
import {POST as verifyPhoneCode} from '@/app/api/settings/phone-verification/verify/route';
import {GET as getContactStatus} from '@/app/api/settings/contact-verification/route';

function request(body?:unknown){
	return new Request('https://aurevia.example/api/settings/contact-verification',{
		method:'POST',
		headers:{'content-type':'application/json'},
		body:body===undefined?undefined:JSON.stringify(body),
	});
}

function matches(row:Record<string,unknown>|null,where:Record<string,unknown>){
	if(!row)return false;
	for(const [key,value] of Object.entries(where)){
		if(key==='userId_channel'){
			const composite=value as Record<string,unknown>;
			if(row.userId!==composite.userId||row.channel!==composite.channel)return false;
			continue;
		}
		const actual=row[key];
		if(value&&typeof value==='object'&&!(value instanceof Date)){
			const conditions=value as Record<string,unknown>;
			for(const [operator,expected] of Object.entries(conditions)){
				if(operator==='increment')continue;
				if(operator==='gt'&&!(actual instanceof Date&&expected instanceof Date&&actual>expected))return false;
				if(operator==='gte'&&!(actual instanceof Date&&expected instanceof Date&&actual>=expected))return false;
				if(operator==='lt'&&!(typeof actual==='number'&&typeof expected==='number'&&actual<expected))return false;
				if(operator==='lte'){
					const comparableActual=actual instanceof Date?actual.getTime():actual;
					const comparableExpected=expected instanceof Date?expected.getTime():expected;
					if(typeof comparableActual==='number'&&typeof comparableExpected==='number'){
						if(comparableActual>comparableExpected)return false;
					}else if(comparableActual!==comparableExpected)return false;
				}
			}
		}else if(actual!==value)return false;
	}
	return true;
}

function applyData(row:Record<string,unknown>,data:Record<string,unknown>){
	for(const [key,value] of Object.entries(data)){
		if(value&&typeof value==='object'&&'increment' in value){
			row[key]=Number(row[key]||0)+Number((value as {increment:number}).increment);
		}else row[key]=value;
	}
}

describe('independent Settings contact verification',()=>{
	beforeEach(()=>{
		state.user={id:'user-1',email:'person@example.invalid',phone:null,status:'ACTIVE',role:'USER',accountMode:'DEMO'};
		state.challenge=null;
		state.audit.length=0;
		state.emailText='';
		vi.clearAllMocks();
		mocks.requireUser.mockResolvedValue({id:'user-1'});
		mocks.userFindUnique.mockImplementation(async()=>({...state.user}));
		mocks.userFindFirst.mockResolvedValue(null);
		mocks.userUpdateMany.mockImplementation(async({where,data})=>{
			if(where.id!==state.user.id||where.phone!==state.user.phone)return {count:0};
			applyData(state.user,data);
			return {count:1};
		});
		mocks.verificationFindUnique.mockImplementation(async({where})=>{
			const channel=where.userId_channel?.channel;
			return state.challenge?.userId===where.userId_channel?.userId&&state.challenge?.channel===channel
				?state.challenge:null;
		});
		mocks.verificationFindFirst.mockImplementation(async({where})=>matches(state.challenge,where)?state.challenge:null);
		mocks.verificationFindMany.mockImplementation(async()=>state.challenge?[state.challenge]:[]);
		mocks.verificationCreate.mockImplementation(async({data})=>{
			state.challenge={id:'verification-1',...data};
			return {id:'verification-1'};
		});
		mocks.verificationUpdateMany.mockImplementation(async({where,data})=>{
			if(!matches(state.challenge,where))return {count:0};
			applyData(state.challenge!,data);
			return {count:1};
		});
		mocks.verificationDeleteMany.mockImplementation(async({where})=>{
			if(!matches(state.challenge,where))return {count:0};
			state.challenge=null;
			return {count:1};
		});
		mocks.auditCreate.mockImplementation(async({data})=>{
			state.audit.push(data);
			return data;
		});
		const tx={
			user:{findUnique:mocks.userFindUnique,findFirst:mocks.userFindFirst,updateMany:mocks.userUpdateMany},
			accountContactVerification:{
				findFirst:mocks.verificationFindFirst,
				updateMany:mocks.verificationUpdateMany,
			},
			auditLog:{create:mocks.auditCreate},
		};
		mocks.transaction.mockImplementation(async callback=>callback(tx));
		mocks.isEmailConfigured.mockReturnValue(true);
		mocks.sendEmail.mockImplementation(async(message:{text:string})=>{
			state.emailText=message.text;
			return {sent:true,provider:'brevo'};
		});
		const provider={id:'termii',send:mocks.sendTermii,verify:mocks.verifyTermii};
		mocks.getSmsProvider.mockReturnValue(provider);
		mocks.formatSmsProviderReference.mockImplementation((_provider:{id:string},reference:string)=>`TERMII:${reference}`);
		mocks.resolveSmsProviderReference.mockImplementation((reference:string)=>reference.startsWith('TERMII:')
			?{provider,reference:reference.slice('TERMII:'.length)}
			:null);
		mocks.sendTermii.mockResolvedValue('test-pin-id');
		mocks.verifyTermii.mockResolvedValue(true);
		mocks.rateLimit.mockImplementation(()=>undefined);
	});

	it('sends and consumes a one-time email code, keeping phone status independent',async()=>{
		const sent=await sendEmailCode(request());
		const code=state.emailText.match(/\b\d{6}\b/)?.[0];
		expect(sent.status).toBe(200);
		expect(code).toBeDefined();
		expect(state.challenge?.channel).toBe('EMAIL');

		const verified=await verifyEmailCode(request({code}));
		expect(verified.status).toBe(200);
		expect(state.challenge?.verifiedAt).toBeInstanceOf(Date);
		expect(state.user.phone).toBeNull();
		expect((await getContactStatus()).status).toBe(200);
		const status=await (await getContactStatus()).json();
		expect(status).toMatchObject({emailVerified:true,phoneVerified:false});

		const reused=await verifyEmailCode(request({code}));
		expect(reused.status).toBe(409);
	});

	it('keeps both statuses false without blocking the account and handles email delivery failure',async()=>{
		const initialStatus=await (await getContactStatus()).json();
		expect(initialStatus).toMatchObject({emailVerified:false,phoneVerified:false});

		mocks.sendEmail.mockResolvedValueOnce({sent:false,provider:'brevo',reason:'provider-rejected'});
		expect((await sendEmailCode(request())).status).toBe(503);
		expect(state.challenge).toBeNull();
	});

	it('rejects incorrect and expired email codes and enforces resend cooldown',async()=>{
		await sendEmailCode(request());
		expect((await sendEmailCode(request())).status).toBe(429);
		expect((await verifyEmailCode(request({code:'000000'}))).status).toBe(400);

		state.challenge!.expiresAt=new Date(Date.now()-1);
		expect((await verifyEmailCode(request({code:'000000'}))).status).toBe(410);
	});

	it('normalizes phone numbers and rejects invalid numbers before requesting SMS',async()=>{
		const invalid=await sendPhoneCode(request({phone:'123',countryCode:'US'}));
		expect(invalid.status).toBe(400);
		expect(mocks.sendTermii).not.toHaveBeenCalled();

		const valid=await sendPhoneCode(request({phone:'(202) 555-0123',countryCode:'US'}));
		expect(valid.status).toBe(200);
		expect(mocks.sendTermii).toHaveBeenCalledWith('+12025550123');
		expect(state.challenge).toMatchObject({channel:'SMS',contact:'+12025550123',providerReference:'TERMII:test-pin-id'});
	});

	it('does not persist a phone challenge when SMS delivery fails',async()=>{
		mocks.sendTermii.mockRejectedValueOnce(new Error('provider unavailable'));

		const response=await sendPhoneCode(request({phone:'2025550123',countryCode:'US'}));

		expect(response.status).toBe(502);
		expect(state.challenge).toBeNull();
		expect(state.user.phone).toBeNull();
	});

	it('stores the Termii PIN reference with its provider type and verifies against that attempt',async()=>{
		expect((await sendPhoneCode(request({phone:'2025550123',countryCode:'US'}))).status).toBe(200);
		expect(state.challenge?.providerReference).toBe('TERMII:test-pin-id');
		expect((await verifyPhoneCode(request({code:'123456'}))).status).toBe(200);
		expect(mocks.verifyTermii).toHaveBeenCalledWith('test-pin-id','123456');
	});

	it('accepts a confirmed phone code, rejects incorrect codes, and prevents replay',async()=>{
		await sendPhoneCode(request({phone:'2025550123',countryCode:'US'}));
		mocks.verifyTermii.mockResolvedValueOnce(false);
		expect((await verifyPhoneCode(request({code:'111111'}))).status).toBe(400);
		expect(state.user.phone).toBeNull();

		mocks.verifyTermii.mockResolvedValueOnce(true);
		expect((await verifyPhoneCode(request({code:'222222'}))).status).toBe(200);
		expect(state.user.phone).toBe('+12025550123');
		expect(state.challenge?.verifiedAt).toBeInstanceOf(Date);
		expect(mocks.verifyTermii).toHaveBeenLastCalledWith('test-pin-id','222222');
		const status=await (await getContactStatus()).json();
		expect(status).toMatchObject({emailVerified:false,phoneVerified:true});
		expect((await verifyPhoneCode(request({code:'222222'}))).status).toBe(409);
	});

	it('rejects expired phone codes and applies verification rate limits',async()=>{
		await sendPhoneCode(request({phone:'2025550123',countryCode:'US'}));
		state.challenge!.expiresAt=new Date(Date.now()-1);
		expect((await verifyPhoneCode(request({code:'123456'}))).status).toBe(410);
		expect(mocks.verifyTermii).not.toHaveBeenCalled();

		mocks.rateLimit.mockImplementationOnce(()=>{throw new Error('RATE_LIMITED');});
		expect((await sendEmailCode(request())).status).toBe(429);
	});

	it('enforces phone send rate limits before invoking the SMS provider',async()=>{
		mocks.rateLimit.mockImplementationOnce(()=>{throw new Error('RATE_LIMITED');});

		expect((await sendPhoneCode(request({phone:'2025550123',countryCode:'US'}))).status).toBe(429);
		expect(mocks.sendTermii).not.toHaveBeenCalled();
	});

	it('enforces the persisted per-challenge phone attempt limit',async()=>{
		await sendPhoneCode(request({phone:'2025550123',countryCode:'US'}));
		state.challenge!.attempts=5;

		expect((await verifyPhoneCode(request({code:'123456'}))).status).toBe(429);
		expect(mocks.verifyTermii).not.toHaveBeenCalled();
	});
});
