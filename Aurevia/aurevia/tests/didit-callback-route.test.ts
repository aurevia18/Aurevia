import {beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({
	requireUser:vi.fn(),
	sessionFindFirst:vi.fn(),
}));

vi.mock('@/lib/auth',()=>({requireUser:mocks.requireUser}));
vi.mock('@/lib/db',()=>({db:{diditVerificationSession:{findFirst:mocks.sessionFindFirst}}}));
vi.mock('@/lib/config/env',()=>({getServerConfiguration:()=>({app:{url:'https://aurevia.example'}})}));

import {GET} from '@/app/api/kyc/didit/callback/route';

const sessionId='123e4567-e89b-42d3-a456-426614174001';

describe('Didit browser callback ownership',()=>{
	beforeEach(()=>vi.clearAllMocks());

	it('redirects only after finding the session owned by the authenticated user',async()=>{
		mocks.requireUser.mockResolvedValue({id:'user-1'});
		mocks.sessionFindFirst.mockResolvedValue({id:'didit-row-1'});

		const response=await GET(new Request(`https://untrusted.invalid/api/kyc/didit/callback?verificationSessionId=${sessionId}`));

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('https://aurevia.example/kyc');
		expect(mocks.sessionFindFirst).toHaveBeenCalledWith({
			where:{sessionId,userId:'user-1'},
			select:{id:true},
		});
	});

	it('does not disclose or redirect to a session belonging to another user',async()=>{
		mocks.requireUser.mockResolvedValue({id:'user-1'});
		mocks.sessionFindFirst.mockResolvedValue(null);

		const response=await GET(new Request(`https://aurevia.example/api/kyc/didit/callback?verificationSessionId=${sessionId}`));

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({error:'Verification session not found.'});
	});
});
