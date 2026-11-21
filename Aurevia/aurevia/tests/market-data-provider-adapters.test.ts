import {describe,expect,it,vi} from 'vitest';
import {TwelveDataMarketProvider} from '@/lib/providers/twelve-data-market-data';

const asset={id:'AAPL',ticker:'AAPL',name:'Apple Inc.',type:'STOCK' as const,currency:'USD'};

describe('market-data provider adapters',()=>{
	it('normalizes Twelve Data quote and history responses without returning credentials',async()=>{
		const fetcher=vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({
				close:'192.5',previous_close:'190',change:'2.5',percent_change:'1.3158',timestamp:1793893800,datetime:'2026-11-05 10:30:00',
				open:'191',high:'193',low:'190',volume:'1000',
			}),{status:200}))
			.mockResolvedValueOnce(new Response(JSON.stringify({values:[{
				datetime:'2026-11-04',open:'190',high:'193',low:'189',close:'192.5',volume:'1000',
			}]}),{status:200}))
			.mockResolvedValueOnce(new Response(JSON.stringify({values:[{
				datetime:'2026-11-04',open:'190',high:'193',low:'189',close:'192.5',volume:'1000',
			}]}),{status:200}));
		const provider=new TwelveDataMarketProvider({apiKey:'twelve-test-secret',fetcher});

		await expect(provider.getQuote(asset)).resolves.toMatchObject({price:192.5,changePercent:1.3158,source:'Twelve Data'});
		await expect(provider.getHistory(asset,'2026-11-01','2026-11-05','1d')).resolves.toEqual([
			{time:expect.any(Number),open:190,high:193,low:189,close:192.5,volume:1000},
		]);
		await expect(provider.getHistory(asset,'2026-11-01','2026-11-05','4h')).resolves.toEqual([
			{time:expect.any(Number),open:190,high:193,low:189,close:192.5,volume:1000},
		]);
		expect(String(fetcher.mock.calls[0][0])).toContain('/quote?symbol=AAPL');
		expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('apikey twelve-test-secret');
		expect(String(fetcher.mock.calls[0][0])).not.toContain('twelve-test-secret');
	});

	it('supports Twelve Data crypto quotes, symbol search, technical indicators, and market state',async()=>{
		const fetcher=vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({
				close:'67000',previous_close:'66000',change:'1000',percent_change:'1.51',timestamp:1793893800,
			}),{status:200}))
			.mockResolvedValueOnce(new Response(JSON.stringify({data:[{
				symbol:'AAPL',instrument_name:'Apple Inc.',exchange:'NASDAQ',instrument_type:'Common Stock',country:'United States',currency:'USD',
			}]}),{status:200}))
			.mockResolvedValueOnce(new Response(JSON.stringify({values:[{datetime:'2026-11-05',rsi:'55.3'}]}),{status:200}))
			.mockResolvedValueOnce(new Response(JSON.stringify({data:[{exchange:'NASDAQ',is_market_open:true}]}),{status:200}));
		const provider=new TwelveDataMarketProvider({apiKey:'twelve-test-secret',fetcher});
		const crypto={id:'BTC',ticker:'BTC-USD',name:'Bitcoin USD',type:'CRYPTO' as const,currency:'USD'};

		await expect(provider.getQuote(crypto)).resolves.toMatchObject({price:67000,source:'Twelve Data'});
		await expect(provider.search('Apple',10)).resolves.toEqual([expect.objectContaining({symbol:'AAPL',name:'Apple Inc.',exchange:'NASDAQ'})]);
		await expect(provider.getIndicator('AAPL','rsi','1d',50)).resolves.toMatchObject({values:[expect.objectContaining({rsi:'55.3'})]});
		await expect(provider.getMarketState()).resolves.toEqual([{exchange:'NASDAQ',is_market_open:true}]);
		expect(String(fetcher.mock.calls[0][0])).toContain('symbol=BTC%2FUSD');
		expect(String(fetcher.mock.calls[1][0])).toContain('/symbol_search?');
		expect(String(fetcher.mock.calls[2][0])).toContain('/rsi?');
		expect(String(fetcher.mock.calls[3][0])).toContain('/market_state');
	});

	it('maps invalid credentials and rate limits to sanitized provider errors',async()=>{
		const unauthorized=new TwelveDataMarketProvider({
			apiKey:'never-log-this-key',
			fetcher:vi.fn().mockResolvedValue(new Response(JSON.stringify({code:401,status:'error',message:'invalid api key'}),{status:200})),
		});
		await expect(unauthorized.getQuote(asset)).rejects.toMatchObject({code:'AUTHENTICATION_FAILED',status:401});
		await expect(unauthorized.getQuote(asset)).rejects.toThrow('Twelve Data market-data request failed.');

		const rateLimitedFetcher=vi.fn(async()=>new Response(JSON.stringify({
			code:429,status:'error',message:'Rate limit exceeded',
		}),{status:200}));
		const rateLimited=new TwelveDataMarketProvider({apiKey:'rate-limit-test-key',fetcher:rateLimitedFetcher});
		await expect(rateLimited.getQuote(asset)).rejects.toMatchObject({code:'RATE_LIMITED',status:429});
		expect(rateLimitedFetcher).toHaveBeenCalledTimes(2);
	});

	it('rejects unavailable symbols without fabricating a quote',async()=>{
		const provider=new TwelveDataMarketProvider({
			apiKey:'unavailable-symbol-test-key',
			fetcher:vi.fn().mockResolvedValue(new Response(JSON.stringify({
				code:404,status:'error',message:'No data found for the symbol',
			}),{status:200})),
		});

		await expect(provider.getQuote(asset)).rejects.toMatchObject({code:'PROVIDER_REJECTED',status:404});
	});

	it('rejects non-positive Twelve Data quote prices',async()=>{
		const provider=new TwelveDataMarketProvider({
			apiKey:'invalid-price-test-key',
			fetcher:vi.fn().mockResolvedValue(new Response(JSON.stringify({
				close:'0',previous_close:'190',change:'-190',percent_change:'-100',timestamp:Math.floor(Date.now()/1000),
			}),{status:200})),
		});

		await expect(provider.getQuote(asset)).rejects.toThrow('Twelve Data quote has no valid price.');
	});

	it('rejects future-dated quotes and candles',async()=>{
		const futureQuote=new TwelveDataMarketProvider({
			apiKey:'twelve-test-secret',
			fetcher:vi.fn().mockResolvedValue(new Response(JSON.stringify({
				close:'192.5',previous_close:'190',change:'2.5',percent_change:'1.3158',timestamp:Math.floor(Date.now()/1000)+60,
			}),{status:200})),
		});
		await expect(futureQuote.getQuote(asset)).rejects.toThrow('future provider timestamp');

		const futureDate=new Date(Date.now()+60_000).toISOString();
		const futureHistory=new TwelveDataMarketProvider({
			apiKey:'twelve-test-secret',
			fetcher:vi.fn().mockResolvedValue(new Response(JSON.stringify({values:[{
				datetime:futureDate,open:'190',high:'193',low:'189',close:'192.5',volume:'1000',
			}]}),{status:200})),
		});
		await expect(futureHistory.getHistory(asset,'2026-11-01','2026-11-05','1d')).rejects.toThrow('future provider timestamps');
	});

});
