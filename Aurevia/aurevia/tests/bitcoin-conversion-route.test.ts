import {AccountMode} from '@prisma/client';
import {beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({
	requireUser:vi.fn(),
	userFindUnique:vi.fn(),
	instrumentFindUnique:vi.fn(),
	getMarketQuote:vi.fn(),
	submitAlpacaPaperOrder:vi.fn(),
	rateLimit:vi.fn(),
	configuration:vi.fn(),
}));

vi.mock('@/lib/auth',()=>({requireUser:mocks.requireUser}));
vi.mock('@/lib/db',()=>({db:{user:{findUnique:mocks.userFindUnique},instrument:{findUnique:mocks.instrumentFindUnique}}}));
vi.mock('@/lib/config/env',()=>({getServerConfiguration:mocks.configuration}));
vi.mock('@/lib/market-data-service',()=>({getAlpacaMarketDataOptions:vi.fn(()=>undefined)}));
vi.mock('@/lib/live-market',()=>({
	getMarketAssetForTradingSymbol:vi.fn(()=>({id:'BTC',ticker:'BTC-USD',type:'CRYPTO'})),
	getMarketQuote:mocks.getMarketQuote,
}));
vi.mock('@/lib/rate-limit',()=>({rateLimit:mocks.rateLimit}));
vi.mock('@/lib/alpaca-paper-orders',()=>({
	submitAlpacaPaperOrder:mocks.submitAlpacaPaperOrder,
	AlpacaPaperOrderError:class extends Error{code='';httpStatus=409},
}));

import {POST} from '@/app/api/wallet/convert-bitcoin/route';

const observedAt=new Date().toISOString();
const request=(body:unknown)=>new Request('http://localhost/api/wallet/convert-bitcoin',{
	method:'POST',
	headers:{'content-type':'application/json','Idempotency-Key':'conversion-key-001'},
	body:JSON.stringify(body),
});

describe('REAL Bitcoin sandbox conversion route',()=>{
	beforeEach(()=>{
		vi.clearAllMocks();
		mocks.requireUser.mockResolvedValue({id:'user-1'});
		mocks.userFindUnique.mockResolvedValue({accountMode:AccountMode.REAL,status:'ACTIVE',role:'USER'});
		mocks.instrumentFindUnique.mockResolvedValue({id:'btc-instrument',enabled:true});
		mocks.configuration.mockReturnValue({
			execution:{alpacaPaperOrdersEnabled:true},
			marketData:{finnhubApiKey:''},
		});
		mocks.getMarketQuote.mockResolvedValue({price:100_000,updatedAt:observedAt,isStale:false});
		mocks.submitAlpacaPaperOrder.mockResolvedValue({
			id:'sandbox-order-1',status:'OPEN',side:'BUY',type:'MARKET',quantity:0.001,filledQuantity:0,
			averageFillPrice:null,reconciliationStatus:null,
		});
	});

	it('converts a USD buy amount into a BTC quantity and routes it to the sandbox order flow',async()=>{
		const response=await POST(request({direction:'BUY',amount:'100.00'}));
		const result=await response.json();

		expect(response.status).toBe(201);
		expect(mocks.submitAlpacaPaperOrder).toHaveBeenCalledWith('user-1',{
			instrumentId:'btc-instrument',side:'BUY',type:'MARKET',quantity:0.001,
			expectedPrice:100_000,observedAt,
		},'conversion-key-001');
		expect(result).toMatchObject({direction:'BUY',estimatedBitcoinAmount:'0.001',executionProvider:'ALPACA_SANDBOX',simulated:true});
		expect(result.order).not.toHaveProperty('providerOrderId');
	});

	it('uses the requested BTC quantity for a sell order',async()=>{
		const response=await POST(request({direction:'SELL',amount:'0.0025'}));

		expect(response.status).toBe(201);
		expect(mocks.submitAlpacaPaperOrder).toHaveBeenCalledWith('user-1',expect.objectContaining({side:'SELL',quantity:0.0025}),'conversion-key-001');
	});

	it('does not route conversions while the active account is in DEMO mode',async()=>{
		mocks.userFindUnique.mockResolvedValue({accountMode:AccountMode.DEMO,status:'ACTIVE',role:'USER'});

		const response=await POST(request({direction:'BUY',amount:'100.00'}));

		expect(response.status).toBe(403);
		expect(mocks.getMarketQuote).not.toHaveBeenCalled();
		expect(mocks.submitAlpacaPaperOrder).not.toHaveBeenCalled();
	});

	it('rejects fractional-cent buy amounts before routing an order',async()=>{
		const response=await POST(request({direction:'BUY',amount:'10.001'}));

		expect(response.status).toBe(400);
		expect(mocks.submitAlpacaPaperOrder).not.toHaveBeenCalled();
	});

	it('keeps REAL conversion unavailable when sandbox routing is disabled',async()=>{
		mocks.configuration.mockReturnValue({
			execution:{alpacaPaperOrdersEnabled:false},
			marketData:{finnhubApiKey:''},
		});

		const response=await POST(request({direction:'BUY',amount:'100.00'}));

		expect(response.status).toBe(403);
		expect(mocks.getMarketQuote).not.toHaveBeenCalled();
		expect(mocks.submitAlpacaPaperOrder).not.toHaveBeenCalled();
	});
});
