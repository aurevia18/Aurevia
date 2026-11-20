import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {
	formatSmsProviderReference,
	generateVerificationCode,
	hashVerificationCode,
	hasConfiguredTermii,
	resolveSmsProviderReference,
	sendTermiiVerificationToken,
	verificationCodeMatches,
	verifyTermiiVerificationToken,
} from '../lib/verification-delivery';

describe('phone verification delivery',()=>{
	const previousSecret=process.env.VERIFICATION_CODE_SECRET;
	const deliveryKeys=['TERMII_API_KEY','TERMII_SENDER_ID','TERMII_BASE_URL'];
	const previousDeliveryValues=Object.fromEntries(deliveryKeys.map(key=>[key,process.env[key]]));

	beforeEach(()=>{
		delete process.env.VERIFICATION_CODE_SECRET;
		for(const key of deliveryKeys)delete process.env[key];
	});

	afterEach(()=>{
		vi.unstubAllGlobals();
		if(previousSecret===undefined)delete process.env.VERIFICATION_CODE_SECRET;
		else process.env.VERIFICATION_CODE_SECRET=previousSecret;
		for(const key of deliveryKeys){
			const value=previousDeliveryValues[key];
			if(value===undefined)delete process.env[key];
			else process.env[key]=value;
		}
	});

	it('generates six-digit codes and verifies only the matching account-bound code',()=>{
		process.env.VERIFICATION_CODE_SECRET='unit-test-only-secret';
		const userId='verification-test-user';
		const code=generateVerificationCode();
		const hash=hashVerificationCode(userId,code);

		expect(code).toMatch(/^\d{6}$/);
		expect(hash).not.toContain(code);
		expect(verificationCodeMatches(userId,code,hash)).toBe(true);
		expect(verificationCodeMatches('another-user',code,hash)).toBe(false);
		expect(verificationCodeMatches(userId,'000000',hash)).toBe(code==='000000');
	});

	it('uses Termii send-token and verify-token APIs for SMS verification',async()=>{
		process.env.TERMII_API_KEY='test-termii-key';
		process.env.TERMII_SENDER_ID='AUREVIA';
		const fetchMock=vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({pin_id:'termii-pin-1'}),{status:200}))
			.mockResolvedValueOnce(new Response(JSON.stringify({verified:'True'}),{status:200}));
		vi.stubGlobal('fetch',fetchMock);

		expect(hasConfiguredTermii()).toBe(true);
		const reference=await sendTermiiVerificationToken('+12125550123');
		expect(reference).toBe('termii-pin-1');
		expect(await verifyTermiiVerificationToken(reference,'123456')).toBe(true);
		expect(fetchMock.mock.calls.map(([url])=>url)).toEqual([
			'https://api.ng.termii.com/api/sms/otp/send',
			'https://api.ng.termii.com/api/sms/otp/verify',
		]);
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
			api_key:'test-termii-key',to:'+12125550123',from:'AUREVIA',pin_length:6,pin_attempts:5,
		});
		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
			api_key:'test-termii-key',pin_id:'termii-pin-1',pin:'123456',
		});
	});

	it('namespaces current provider references and rejects retired Twilio references',()=>{
		const provider={id:'termii' as const,send:vi.fn(),verify:vi.fn()};
		expect(formatSmsProviderReference(provider,'termii-pin')).toBe('TERMII:termii-pin');
		expect(resolveSmsProviderReference('TERMII:termii-pin')?.reference).toBe('termii-pin');
		expect(resolveSmsProviderReference('TWILIO')).toBeNull();
		expect(resolveSmsProviderReference('TWILIO:verification-id')).toBeNull();
	});

	it('uses an official configured Termii base URL and rejects invalid domains',async()=>{
		process.env.TERMII_API_KEY='test-termii-key';
		process.env.TERMII_SENDER_ID='AUREVIA';
		process.env.TERMII_BASE_URL='https://api.eu.termii.com';
		const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({pin_id:'termii-pin-2'}),{status:200}));
		vi.stubGlobal('fetch',fetchMock);

		await sendTermiiVerificationToken('+12125550123');
		expect(fetchMock.mock.calls[0][0]).toBe('https://api.eu.termii.com/api/sms/otp/send');

		process.env.TERMII_BASE_URL='https://example.invalid';
		expect(hasConfiguredTermii()).toBe(false);
		await expect(sendTermiiVerificationToken('+12125550123')).rejects.toThrow('PHONE_VERIFICATION_DELIVERY_UNAVAILABLE');
	});

	it('does not expose provider response bodies in delivery errors',async()=>{
		process.env.TERMII_API_KEY='test-termii-key';
		process.env.TERMII_SENDER_ID='AUREVIA';
		vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(
			JSON.stringify({message:'private provider details'}),
			{status:401},
		)));

		await expect(sendTermiiVerificationToken('+12125550123')).rejects.toMatchObject({
			failureStage:'provider_response',
			httpStatus:401,
		});
	});
});
