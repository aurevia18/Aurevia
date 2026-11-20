import {Prisma} from '@prisma/client';
import {beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({
	parseAndVerify:vi.fn(),
	sessionFindUnique:vi.fn(),
	sessionFindFirst:vi.fn(),
	sessionUpdateMany:vi.fn(),
	eventCreate:vi.fn(),
	kycCaseFindFirst:vi.fn(),
	userFindUnique:vi.fn(),
	userUpdateMany:vi.fn(),
	transaction:vi.fn(),
}));

vi.mock('@/lib/config/env',()=>({
	getServerConfiguration:()=>({didit:{enabled:true,configured:true,environment:'sandbox'}}),
}));
vi.mock('@/lib/db',()=>({db:{
	diditVerificationSession:{
		findUnique:mocks.sessionFindUnique,
		findFirst:mocks.sessionFindFirst,
		updateMany:mocks.sessionUpdateMany,
	},
	diditWebhookEvent:{create:mocks.eventCreate},
	kycVerification:{findFirst:mocks.kycCaseFindFirst},
	user:{findUnique:mocks.userFindUnique,updateMany:mocks.userUpdateMany},
	$transaction:mocks.transaction,
}}));
vi.mock('@/lib/didit',async importOriginal=>{
	const actual=await importOriginal<typeof import('@/lib/didit')>();
	return {
		...actual,
		parseAndVerifyDiditWebhook:mocks.parseAndVerify,
		diditEnvironmentWebhookValue:()=> 'sandbox',
		isDiditTerminalStatus:(status:string)=>['Approved','Declined','Expired','Abandoned','Kyc Expired'].includes(status),
		toLocalKycStatus:(status:string)=>status==='Approved'?'APPROVED':status==='Declined'?'REJECTED':'PENDING',
	};
});

import {POST} from '@/app/api/webhooks/didit/route';

const sessionId='123e4567-e89b-42d3-a456-426614174001';
const sessionRow={id:'didit-row-1',userId:'user-1',workflowId:'123e4567-e89b-42d3-a456-426614174000',vendorData:'opaque-association',environment:'sandbox',createdAt:new Date('2026-01-01T00:00:00Z')};

function request(){
	return new Request('https://aurevia.example/api/webhooks/didit',{
		method:'POST',
		headers:{'content-type':'application/json','x-timestamp':'1','x-signature-v2':'a'.repeat(64)},
		body:'{"signed":"payload"}',
	});
}

describe('Didit status webhook route',()=>{
	let state:{lastEventAt:Date|null;events:Set<string>;status:string};
	let tx:{diditVerificationSession:Record<string,unknown>;diditWebhookEvent:Record<string,unknown>;kycVerification:Record<string,unknown>;user:Record<string,unknown>};

	beforeEach(()=>{
		vi.clearAllMocks();
		state={lastEventAt:null,events:new Set(),status:'Not Started'};
		const payload={
			webhook_type:'status.updated',
			event_id:'123e4567-e89b-42d3-a456-426614174002',
			session_id:sessionId,
			timestamp:Math.floor(Date.now()/1000),
			created_at:Math.floor(Date.now()/1000),
			environment:'sandbox',
			session_kind:'user',
			workflow_id:sessionRow.workflowId,
			vendor_data:sessionRow.vendorData,
			status:'Approved',
		};
		mocks.parseAndVerify.mockReturnValue(payload);
		mocks.sessionFindUnique.mockResolvedValue(sessionRow);
		mocks.eventCreate.mockImplementation(async({data}:{data:{eventId:string}})=>{
			if(state.events.has(data.eventId)){
				throw new Prisma.PrismaClientKnownRequestError('Duplicate event',{
					code:'P2002',
					clientVersion:'test',
				});
			}
			state.events.add(data.eventId);
			return data;
		});
		mocks.sessionFindFirst.mockResolvedValue({id:sessionRow.id});
		mocks.sessionUpdateMany.mockImplementation(async({data}:{data:{status:string;lastEventAt:Date}})=>{
			state.status=data.status;
			state.lastEventAt=data.lastEventAt;
			return {count:1};
		});
		mocks.kycCaseFindFirst.mockResolvedValue(null);
		mocks.userFindUnique.mockResolvedValue({status:'ACTIVE',role:'USER',accountMode:'REAL'});
		mocks.userUpdateMany.mockResolvedValue({count:1});
		tx={
			diditVerificationSession:{
				findUnique:vi.fn().mockImplementation(async()=>({id:sessionRow.id,userId:'user-1',lastEventAt:state.lastEventAt,createdAt:sessionRow.createdAt})),
				findFirst:mocks.sessionFindFirst,
				updateMany:mocks.sessionUpdateMany,
			},
			diditWebhookEvent:{create:mocks.eventCreate},
			kycVerification:{findFirst:mocks.kycCaseFindFirst},
			user:{findUnique:mocks.userFindUnique,updateMany:mocks.userUpdateMany},
		};
		mocks.transaction.mockImplementation(async(callback:(transaction:typeof tx)=>Promise<unknown>)=>callback(tx));
	});

	it('processes a trusted status update once and updates the linked account status',async()=>{
		const response=await POST(request());

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({received:true});
		expect(mocks.sessionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
			where:{id:sessionRow.id,lastEventAt:null},
			data:expect.objectContaining({status:'Approved',decision:{status:'Approved'}}),
		}));
		expect(mocks.userUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
			where:{id:'user-1',status:'ACTIVE',role:'USER',accountMode:'REAL'},
			data:{kycStatus:'APPROVED'},
		}));
	});

	it('acknowledges duplicate event IDs without applying the decision again',async()=>{
		const first=await POST(request());
		expect(first.status).toBe(200);
		mocks.eventCreate.mockImplementationOnce(async()=>{
			throw new Prisma.PrismaClientKnownRequestError('Duplicate event',{
				code:'P2002',
				clientVersion:'test',
			});
		});

		const duplicate=await POST(request());

		expect(duplicate.status).toBe(200);
		expect(await duplicate.json()).toEqual({received:true,duplicate:true});
		expect(mocks.userUpdateMany).toHaveBeenCalledTimes(1);
	});

	it('does not trust webhook status when the signed session association differs',async()=>{
		mocks.parseAndVerify.mockReturnValueOnce({
			webhook_type:'status.updated',
			event_id:'123e4567-e89b-42d3-a456-426614174002',
			session_id:sessionId,
			timestamp:Math.floor(Date.now()/1000),
			created_at:Math.floor(Date.now()/1000),
			environment:'sandbox',
			workflow_id:sessionRow.workflowId,
			vendor_data:'another-user',
			status:'Approved',
		});

		const response=await POST(request());

		expect(response.status).toBe(200);
		expect(mocks.eventCreate).not.toHaveBeenCalled();
		expect(mocks.userUpdateMany).not.toHaveBeenCalled();
	});
});
