import {beforeEach,describe,expect,it,vi} from 'vitest';
import {getMarketAsset} from '@/lib/live-market';

vi.mock('bottleneck',()=>({
	default:class{
		static strategy={OVERFLOW:1};
		constructor(){}
		schedule<T>(operation:()=>Promise<T>){return operation()}
	},
}));

import {getConfiguredMarketQuote,getMarketProviderReadiness} from '@/lib/market-data/provider-manager';

beforeEach(()=>vi.unstubAllEnvs());

describe('market-data provider selection and readiness',()=>{
	it('uses Twelve Data exclusively and returns its normalized stock quote',async()=>{
		const fetcher=vi.fn(async(_input:RequestInfo|URL)=>{
			return new Response(JSON.stringify({
				close:'192.5',previous_close:'190',change:'2.5',percent_change:'1.3158',timestamp:1793893800,
			}),{status:200});
		});
		vi.stubGlobal('fetch',fetcher);
		const quote=await getConfiguredMarketQuote(getMarketAsset('AAPL')!,{
			twelveDataApiKey:'twelve-working-key',twelveDataBaseUrl:'https://api.twelvedata.com',productionLicenseConfirmed:false,
		});

		expect(quote).toMatchObject({price:192.5,source:'Twelve Data'});
		expect(fetcher).toHaveBeenCalledOnce();
		expect(String(fetcher.mock.calls[0][0])).toContain('api.twelvedata.com/quote?symbol=AAPL');
		expect(JSON.stringify(quote)).not.toContain('twelve-working-key');
	});

	it('reports Twelve Data connected only after an authenticated request and redacts keys',async()=>{
		const key='twelve-readiness-secret';
		vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({
			close:'190',previous_close:'188',change:'2',percent_change:'1.06',timestamp:1793893800,
		}),{status:200})));
		const readiness=await getMarketProviderReadiness({
			twelveDataApiKey:key,twelveDataBaseUrl:'https://api.twelvedata.com',productionLicenseConfirmed:false,
		});
		const twelveData=readiness.find(provider=>provider.id==='twelveData');

		expect(readiness).toHaveLength(1);
		expect(twelveData).toMatchObject({configured:true,status:'CONNECTED'});
		expect(JSON.stringify(readiness)).not.toContain(key);
	});

	it('requires the production license confirmation before provider requests',async()=>{
		vi.stubEnv('NODE_ENV','production');
		const fetcher=vi.fn();
		vi.stubGlobal('fetch',fetcher);

		await expect(getConfiguredMarketQuote(getMarketAsset('AAPL')!,{
			twelveDataApiKey:'',twelveDataBaseUrl:'https://api.twelvedata.com',productionLicenseConfirmed:false,
		})).resolves.toBeNull();
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('does not fall back to another provider when Twelve Data fails',async()=>{
		const fetcher=vi.fn().mockResolvedValue(new Response('unauthorized',{status:401}));
		vi.stubGlobal('fetch',fetcher);
		await expect(getConfiguredMarketQuote(getMarketAsset('AAPL')!,{
			twelveDataApiKey:'twelve-key',twelveDataBaseUrl:'https://api.twelvedata.com',productionLicenseConfirmed:false,
		})).resolves.toBeNull();
		expect(fetcher).toHaveBeenCalledOnce();
		expect(String(fetcher.mock.calls[0][0])).toContain('api.twelvedata.com/quote?symbol=AAPL');
	});

	it('does not make provider requests when Twelve Data is not configured',async()=>{
		const fetcher=vi.fn();
		vi.stubGlobal('fetch',fetcher);
		await expect(getConfiguredMarketQuote(getMarketAsset('SPX')!,{
			twelveDataApiKey:'',twelveDataBaseUrl:'https://api.twelvedata.com',productionLicenseConfirmed:false,
		})).resolves.toBeNull();
		expect(fetcher).not.toHaveBeenCalled();
	});
});
