import {describe,expect,it,vi} from 'vitest';
import {requestMarketProviderJson} from '@/lib/providers/market-data-http';

describe('market-data HTTP requests',()=>{
	it('retries transient provider failures and sends bounded no-store requests',async()=>{
		const fetcher=vi.fn()
			.mockResolvedValueOnce(new Response('temporarily unavailable',{status:503}))
			.mockResolvedValueOnce(new Response(JSON.stringify({price:190}),{status:200}));

		await expect(requestMarketProviderJson(
			'Test provider',
			'https://provider.example/quote',
			fetcher,
			{'x-api-key':'test-key'},
		)).resolves.toEqual({price:190});

		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(fetcher.mock.calls[1][1]).toMatchObject({
			headers:{'x-api-key':'test-key'},
			cache:'no-store',
		});
		expect(fetcher.mock.calls[1][1]?.signal).toBeInstanceOf(AbortSignal);
	});

	it('does not retry rejected credentials or expose provider credentials in errors',async()=>{
		const fetcher=vi.fn().mockResolvedValue(new Response('invalid credentials',{status:401}));

		await expect(requestMarketProviderJson(
			'Test provider',
			'https://provider.example/quote?apikey=private-test-key',
			fetcher,
		)).rejects.toThrow('Test provider market-data request failed.');

		expect(fetcher).toHaveBeenCalledOnce();
	});
});
