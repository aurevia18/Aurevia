import {createHmac} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {
	canonicalizeDiditPayload,
	createDiditSession,
	DiditApiError,
	parseAndVerifyDiditWebhook,
} from '@/lib/didit';

const workflowId='123e4567-e89b-42d3-a456-426614174000';
const sessionId='123e4567-e89b-42d3-a456-426614174001';

function signedWebhook(payload:Record<string,unknown>,secret:string){
	const body=JSON.stringify(payload);
	const signature=createHmac('sha256',secret).update(canonicalizeDiditPayload(payload),'utf8').digest('hex');
	return {body,headers:new Headers({'x-timestamp':String(payload.timestamp),'x-signature-v2':signature})};
}

describe('Didit session and webhook contracts',()=>{
	beforeEach(()=>{
		vi.stubEnv('DIDIT_ENABLED','true');
		vi.stubEnv('DIDIT_ENV','sandbox');
		vi.stubEnv('DIDIT_API_KEY','test-didit-key');
		vi.stubEnv('DIDIT_WORKFLOW_ID',workflowId);
		vi.stubEnv('DIDIT_WEBHOOK_SECRET','test-webhook-secret');
	});

	afterEach(()=>{
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it('creates only a validated hosted session through Didit v3',async()=>{
		const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({
			session_id:sessionId,
			session_kind:'user',
			status:'Not Started',
			url:'https://verify.didit.me/session/opaque',
			expires_at:'2030-01-01T00:00:00.000Z',
			workflow_id:workflowId,
			vendor_data:'opaque-user-association',
			session_token:'provider-token-must-not-be-returned',
		}),{status:201}));
		vi.stubGlobal('fetch',fetchMock);

		const result=await createDiditSession({
			vendorData:'opaque-user-association',
			callback:'https://aurevia.example/api/kyc/didit/callback',
		});

		expect(fetchMock).toHaveBeenCalledWith('https://verification.didit.me/v3/session/',expect.objectContaining({
			method:'POST',
			headers:expect.objectContaining({'x-api-key':'test-didit-key'}),
		}));
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
			workflow_id:workflowId,
			vendor_data:'opaque-user-association',
			callback:'https://aurevia.example/api/kyc/didit/callback',
			callback_method:'both',
		});
		expect(result).toMatchObject({sessionId,status:'Not Started',workflowId,vendorData:'opaque-user-association'});
		expect(JSON.stringify(result)).not.toContain('provider-token-must-not-be-returned');
	});

	it('rejects untrusted hosted URLs and malformed provider responses',async()=>{
		vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({
			session_id:sessionId,
			session_kind:'user',
			status:'Not Started',
			url:'https://attacker.example/session/opaque',
			expires_at:'2030-01-01T00:00:00.000Z',
			workflow_id:workflowId,
			vendor_data:'opaque-user-association',
		}),{status:201})));

		await expect(createDiditSession({vendorData:'opaque-user-association',callback:'https://aurevia.example/callback'}))
			.rejects.toBeInstanceOf(DiditApiError);
	});

	it('validates Didit V2 HMAC signatures, timestamps, and canonical JSON',()=>{
		const now=Date.now();
		const timestamp=Math.floor(now/1000);
		const payload={
			webhook_type:'status.updated',
			timestamp,
			status:'Approved',
			session_id:sessionId,
			event_id:'123e4567-e89b-42d3-a456-426614174002',
			vendor_data:'opaque-user-association',
		};
		const signed=signedWebhook(payload,'test-webhook-secret');

		expect(parseAndVerifyDiditWebhook(signed.body,signed.headers,now)).toMatchObject(payload);
		expect(()=>parseAndVerifyDiditWebhook(signed.body,signed.headers,now+6*60_000)).toThrow(DiditApiError);
		const modifiedHeaders=new Headers(signed.headers);
		modifiedHeaders.set('x-signature-v2','0'.repeat(64));
		expect(()=>parseAndVerifyDiditWebhook(signed.body,modifiedHeaders,now)).toThrow(DiditApiError);
		const mismatchedHeaders=new Headers(signed.headers);
		mismatchedHeaders.set('x-timestamp',String(timestamp+1));
		expect(()=>parseAndVerifyDiditWebhook(signed.body,mismatchedHeaders,now)).toThrow(DiditApiError);
	});
});
