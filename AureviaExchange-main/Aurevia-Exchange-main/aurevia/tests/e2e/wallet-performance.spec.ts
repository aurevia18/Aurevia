import {test,expect,loginAs,waitForStartup} from './fixtures';
import type {Request} from '@playwright/test';

function fixture(name:string){
	const value=process.env[`AUREVIA_E2E_${name}`];
	if(!value)throw new Error(`Playwright fixture ${name} is unavailable.`);
	return value;
}

test('wallet initial load records authoritative balance and request timings',async({page})=>{
	const requests:{path:string;elapsedMs:number}[]=[];
	const requestStartedAt=new WeakMap<Request,number>();
	page.on('request',request=>requestStartedAt.set(request,Date.now()));
	page.on('response',response=>{
		const path=new URL(response.url()).pathname;
		if(!path.startsWith('/api/'))return;
		const started=requestStartedAt.get(response.request());
		if(started!==undefined)requests.push({path,elapsedMs:Date.now()-started});
	});

	await loginAs(page,fixture('USER_EMAIL'),fixture('USER_PASSWORD'));
	requests.length=0;
	const startedAt=Date.now();
	await page.goto('/wallet');
	await waitForStartup(page);
	const balance=page.locator('.wallet-balance-value');
	await expect(balance).not.toHaveText('Loading…');
	await expect(balance).not.toHaveText('Unavailable');
	await expect(balance).not.toBeEmpty();

	const walletRequest=requests.filter(request=>request.path==='/api/wallet');
	expect(walletRequest).toHaveLength(1);
	console.info('[wallet-performance] Initial wallet load',JSON.stringify({
		pageToAuthoritativeBalanceMs:Date.now()-startedAt,
		apiRequests:requests.length,
		apiTimingsMs:requests.map(({path,elapsedMs})=>({path,elapsedMs})),
	}));
});
