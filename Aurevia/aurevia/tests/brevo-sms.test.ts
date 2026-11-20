import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {BrevoSmsDeliveryError,sendBrevoTransactionalSms} from '@/lib/brevo-sms';

describe('Brevo transactional SMS delivery',()=>{
	let fetchMock:ReturnType<typeof vi.fn>;

	beforeEach(()=>{
		vi.stubEnv('BREVO_API_KEY','test-api-key');
		vi.stubEnv('BREVO_SENDER_NAME','Aurevia');
		fetchMock=vi.fn();
		vi.stubGlobal('fetch',fetchMock);
	});

	afterEach(()=>{
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it('sends a transactional SMS through the server-side Brevo API',async()=>{
		fetchMock.mockResolvedValue(new Response(JSON.stringify({messageId:123456}),{status:201}));

		await expect(sendBrevoTransactionalSms('+14155552671','Approval notice')).resolves.toBe('123456');

		expect(fetchMock).toHaveBeenCalledWith('https://api.brevo.com/v3/transactionalSMS/sms',expect.objectContaining({
			method:'POST',
			headers:expect.objectContaining({'api-key':'test-api-key'}),
		}));
		const body=JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body).toMatchObject({
			sender:'Aurevia',
			recipient:'+14155552671',
			content:'Approval notice',
			type:'transactional',
		});
	});

	it('keeps provider rejections sanitized while retaining the safe error code',async()=>{
		fetchMock.mockResolvedValue(new Response(JSON.stringify({
			code:'not_enough_credits',
			message:'Sensitive provider response text',
		}),{status:402}));

		await expect(sendBrevoTransactionalSms('+14155552671','Approval notice')).rejects.toMatchObject({
			name:'BrevoSmsDeliveryError',
			failureStage:'provider_response',
			httpStatus:402,
			providerCode:'NOT_ENOUGH_CREDITS',
		});
	});

	it('does not call Brevo when its configured sender is invalid for SMS',async()=>{
		vi.stubEnv('BREVO_SENDER_NAME','Aurevia Finance');

		await expect(sendBrevoTransactionalSms('+14155552671','Approval notice')).rejects.toBeInstanceOf(BrevoSmsDeliveryError);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
