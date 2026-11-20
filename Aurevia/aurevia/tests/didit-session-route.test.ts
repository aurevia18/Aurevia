import {beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({
	requireUser:vi.fn(),
	userFindUnique:vi.fn(),
	firstPartyFindFirst:vi.fn(),
	sessionFindUnique:vi.fn(),
	sessionCreate:vi.fn(),
	userUpdateMany:vi.fn(),
	transaction:vi.fn(),
	createDiditSession:vi.fn(),
	rateLimit:vi.fn(),
}));

vi.mock('@/lib/auth',()=>({requireUser:mocks.requireUser}));
vi.mock('@/lib/db',()=>({db:{
	user:{findUnique:mocks.userFindUnique},
	kycVerification:{findFirst:mocks.firstPartyFindFirst},
	diditVerificationSession:{findUnique:mocks.sessionFindUnique},
	$transaction:mocks.transaction,
}}));
vi.mock('@/lib/config/env',()=>({
	getServerConfiguration:()=>({
		didit:{
			enabled:true,configured:true,environment:'sandbox',apiKey:'test-api-key',workflowId:'123e4567-e89b-42d3-a456-426614174000',
		},
		app:{url:'https://aurevia.example'},
	}),
}));
vi.mock('@/lib/didit',()=>({
	createDiditSession:mocks.createDiditSession,
	DiditApiError:class DiditApiError extends Error{
		constructor(readonly failureStage:string,readonly httpStatus:number|null=null,readonly underlyingErrorType:string|null=null){super('DIDIT_REQUEST_FAILED')}
	},
}));
vi.mock('@/lib/production-policy',()=>({getTierProfileRequirements:()=>({profileComplete:true})}));
vi.mock('@/lib/rate-limit',()=>({rateLimit:vi.fn()}));

import {POST} from '@/app/api/kyc/didit-session/route';

const providerSession={
	sessionId:'123e4567-e89b-42d3-a456-426614174001',
	url:'https://verify.didit.me/session/opaque',
	expiresAt:new Date('2030-01-01T00:00:00Z'),
	status:'Not Started',
	workflowId:'123e4567-e89b-42d3-a456-426614174000',
	vendorData:'provider-bound-data',
	sessionToken:'never-return-this',
};

describe('Didit session creation route',()=>{
	beforeEach(()=>{
		vi.clearAllMocks();
		mocks.requireUser.mockResolvedValue({id:'user-1'});
		mocks.userFindUnique.mockResolvedValue({
			id:'user-1',name:'Test User',country:'US',status:'ACTIVE',role:'USER',accountMode:'REAL',approvedTier:2,kycStatus:'PENDING',
		});
		mocks.firstPartyFindFirst.mockResolvedValue(null);
		mocks.sessionFindUnique.mockResolvedValue(null);
		mocks.sessionCreate.mockResolvedValue({});
		mocks.userUpdateMany.mockResolvedValue({count:1});
		mocks.transaction.mockImplementation(async(callback:(transaction:Record<string,unknown>)=>Promise<unknown>)=>callback({
			user:{findUnique:mocks.userFindUnique,updateMany:mocks.userUpdateMany},
			kycVerification:{findFirst:mocks.firstPartyFindFirst},
			diditVerificationSession:{findUnique:mocks.sessionFindUnique,create:mocks.sessionCreate},
		}));
		mocks.createDiditSession.mockResolvedValue(providerSession);
		mocks.rateLimit.mockImplementation(()=>undefined);
	});

	it('persists the session against its authenticated user and returns only the hosted redirect',async()=>{
		const response=await POST();

		expect(response.status).toBe(201);
		const body=await response.json();
		expect(body).toMatchObject({
			sessionId:providerSession.sessionId,
			status:'Not Started',
			url:providerSession.url,
			expiresAt:providerSession.expiresAt.toISOString(),
		});
		expect(JSON.stringify(body)).not.toContain('never-return-this');
		expect(mocks.sessionCreate).toHaveBeenCalledWith({data:expect.objectContaining({
			userId:'user-1',
			sessionId:providerSession.sessionId,
			workflowId:providerSession.workflowId,
			vendorData:providerSession.vendorData,
			environment:'sandbox',
			status:'Not Started',
		})});
		expect(mocks.userUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
			where:expect.objectContaining({id:'user-1',status:'ACTIVE',role:'USER',accountMode:'REAL'}),
			data:{kycStatus:'PENDING'},
		}));
	});

	it('does not contact Didit for ineligible DEMO accounts',async()=>{
		mocks.userFindUnique.mockResolvedValueOnce({
			id:'user-1',status:'ACTIVE',role:'USER',accountMode:'DEMO',approvedTier:1,kycStatus:'PENDING',
		});

		const response=await POST();

		expect(response.status).toBe(403);
		expect(mocks.createDiditSession).not.toHaveBeenCalled();
		expect(mocks.sessionCreate).not.toHaveBeenCalled();
	});
});
