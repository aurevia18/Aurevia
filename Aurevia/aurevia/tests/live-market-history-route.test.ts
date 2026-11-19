import {beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({
	getHistory:vi.fn(),
	getAlpacaOptions:vi.fn(),
	getConfiguration:vi.fn(),
	getReferenceHistory:vi.fn(),
}));

vi.mock('@/lib/config/env',()=>({getServerConfiguration:mocks.getConfiguration}));
vi.mock('@/lib/market-data-service',()=>({
	getAlpacaMarketDataOptions:mocks.getAlpacaOptions,
	getAdditionalMarketProviderKeys:()=>({twelveDataApiKey:'',alphaVantageApiKey:'',fmpApiKey:'',productionLicenseConfirmed:false}),
	getMarketHistoryWithFallback:mocks.getHistory,
}));
vi.mock('@/lib/internal-market-data',()=>({
	getReferenceMarketHistory:mocks.getReferenceHistory,
}));

import {GET} from '@/app/api/live-markets/[symbol]/route';
import {MarketDataError} from '@/lib/live-market';

const request=(timeframe='1d')=>new Request(`https://aurevia.test/api/live-markets/AAPL?timeframe=${timeframe}`);
const diagnostics={
	selectedProvider:'none' as const,
	alpaca:{status:'failed' as const,reason:'invalid_credentials',httpStatus:401},
	finnhub:{status:'failed' as const,reason:'provider_server_error',httpStatus:503,providerCode:'UPSTREAM_ERROR'},
};

beforeEach(()=>{
	vi.clearAllMocks();
	mocks.getConfiguration.mockReturnValue({marketData:{finnhubApiKey:'server-key'},execution:{}});
	mocks.getAlpacaOptions.mockReturnValue(undefined);
	mocks.getReferenceHistory.mockReturnValue({
		source:'Aurevia Internal',
		candles:[{time:1_800_000_000,open:190,high:192,low:188,close:191,volume:null}],
	});
});

describe('market history route fallback',()=>{
	it('returns internal candles instead of failing when a configured provider rejects access',async()=>{
		mocks.getHistory.mockRejectedValue(new MarketDataError('Configured historical market-data providers failed.',503,diagnostics));

		const response=await GET(request(),{params:Promise.resolve({symbol:'AAPL'})});
		const body=await response.json();

		expect(response.status).toBe(200);
		expect(body).toMatchObject({
			source:'Aurevia Internal',
			candles:[expect.objectContaining({close:191})],
		});
		expect(JSON.stringify(body)).not.toContain('server-key');
		expect(JSON.stringify(body)).not.toContain('providerMessage');
	});

	it('returns fallback candles for rate limits and keeps timeframe validation intact',async()=>{
		mocks.getHistory.mockRejectedValue(new MarketDataError('Configured historical market-data providers failed.',503,{
			...diagnostics,
			alpaca:{status:'failed',reason:'rate_limited',httpStatus:429},
		}));

		const response=await GET(request('ytd'),{params:Promise.resolve({symbol:'AAPL'})});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({source:'Aurevia Internal'});
		expect(mocks.getHistory).toHaveBeenCalledWith(
			expect.objectContaining({id:'AAPL'}),
			'ytd',
			'server-key',
			undefined,
			{twelveDataApiKey:'',alphaVantageApiKey:'',fmpApiKey:'',productionLicenseConfirmed:false},
		);
		expect((await GET(request('invalid'),{params:Promise.resolve({symbol:'AAPL'})})).status).toBe(400);
	});

	it('returns fallback candles when every provider has no candles for the range',async()=>{
		mocks.getHistory.mockRejectedValue(new MarketDataError('Configured historical market-data providers failed.',503,{
			selectedProvider:'none',
			alpaca:{status:'failed',reason:'no_data',httpStatus:200,providerCode:'no_data'},
			finnhub:{status:'failed',reason:'no_data',httpStatus:200,providerCode:'no_data'},
		}));

		const response=await GET(request(),{params:Promise.resolve({symbol:'AAPL'})});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({source:'Aurevia Internal'});
	});
});
