import {expect,test,type Page} from '@playwright/test';

const introKey='aurevia-cinematic-intro-complete';

async function holdVideoRequests(page:Page){
	const releases:Array<()=>Promise<void>>=[];
	await page.route('**/Videos/*.mp4',route=>new Promise<void>(resolve=>{
		releases.push(async()=>{
			try{await route.abort()}catch{}
			resolve();
		});
	}));
	return async()=>Promise.all(releases.map(release=>release()));
}

async function prepareFirstVisit(page:Page,playResult:'resolve'|'reject'){
	await page.addInitScript(({result})=>{
		Object.defineProperty(HTMLMediaElement.prototype,'play',{
			configurable:true,
			value:()=>result==='resolve'?Promise.resolve():Promise.reject(new Error('Autoplay blocked')),
		});
	},{result:playResult});
}

test('desktop intro falls back to the available orientation, ends, skips, and stays complete',async({page})=>{
	await page.setViewportSize({width:1440,height:900});
	await page.emulateMedia({reducedMotion:'no-preference'});
	await prepareFirstVisit(page,'resolve');
	const releaseVideoRequests=await holdVideoRequests(page);
	let releaseInitialDesktop:undefined|(()=>Promise<void>);
	let desktopRequestCount=0;
	await page.route('**/Videos/aurevia-intro-desktop.mp4',route=>{
		desktopRequestCount+=1;
		if(desktopRequestCount>1)return route.abort();
		return new Promise<void>(resolve=>{
			releaseInitialDesktop=async()=>{
				try{await route.abort()}finally{resolve()}
			};
		});
	});
	try{
		await page.goto('/');
		const intro=page.getByRole('dialog',{name:'Aurevia Exchange introduction'});
		await expect(intro).toBeVisible();
		const video=page.locator('.exchange-intro-video');
		await expect(video).toHaveAttribute('src','/Videos/aurevia-intro-desktop.mp4');
		if(!releaseInitialDesktop)throw new Error('Desktop video request did not start.');
		await releaseInitialDesktop();
		await expect(video).toHaveAttribute('src','/Videos/aurevia-intro-mobile.mp4');

		await video.evaluate(element=>element.dispatchEvent(new Event('ended',{bubbles:true})));
		await expect(intro).toBeHidden();
		await expect(page.locator('h1:visible').first()).toBeVisible();
		expect(await page.evaluate(key=>localStorage.getItem(key),introKey)).toBe('1');

		await page.getByRole('button',{name:'Replay intro'}).click();
		await expect(intro).toBeVisible();
		await page.getByRole('button',{name:'Skip intro'}).click();
		await expect(intro).toBeHidden();
		await expect(page.getByRole('button',{name:'Replay intro'})).toBeVisible();
		await page.reload();
		await expect(intro).toHaveCount(0);
		await expect(page.locator('h1:visible').first()).toBeVisible();
	}finally{
		await releaseVideoRequests();
	}
});
test('portrait devices select the mobile video and autoplay failures offer playback',async({page})=>{
	await page.setViewportSize({width:390,height:844});
	await page.emulateMedia({reducedMotion:'no-preference'});
	await prepareFirstVisit(page,'reject');
	const releaseVideoRequests=await holdVideoRequests(page);
	try{
		await page.goto('/');
		await expect(page.getByRole('dialog',{name:'Aurevia Exchange introduction'})).toBeVisible();
		await expect(page.locator('.exchange-intro-video')).toHaveAttribute('src','/Videos/aurevia-intro-mobile.mp4');
		expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
		await expect(page.getByRole('button',{name:'Play intro'})).toBeVisible();
		await page.getByRole('button',{name:'Play intro'}).click();
		await expect(page.getByRole('button',{name:'Play intro'})).toBeVisible();
		await page.getByRole('button',{name:'Skip intro'}).click();
		await expect(page.getByRole('dialog',{name:'Aurevia Exchange introduction'})).toBeHidden();
	}finally{
		await releaseVideoRequests();
	}
});

test('missing video files offer a safe way to continue to the homepage',async({page})=>{
	await page.setViewportSize({width:1280,height:900});
	await page.emulateMedia({reducedMotion:'no-preference'});
	await prepareFirstVisit(page,'resolve');
	await page.route('**/Videos/*.mp4',route=>route.abort());
	await page.goto('/');
	await expect(page.getByRole('status')).toHaveText('The introduction video is unavailable.');
	await page.getByRole('button',{name:'Continue to Aurevia'}).click();
	await expect(page.getByRole('dialog',{name:'Aurevia Exchange introduction'})).toBeHidden();
	await expect(page.locator('h1:visible').first()).toBeVisible();
});

test('reduced-motion visitors bypass automatic playback',async({page})=>{
	await page.setViewportSize({width:1280,height:900});
	await page.emulateMedia({reducedMotion:'reduce'});
	await page.addInitScript(key=>localStorage.removeItem(key),introKey);
	await page.goto('/');
	await expect(page.getByRole('dialog',{name:'Aurevia Exchange introduction'})).toHaveCount(0);
	await expect(page.locator('h1:visible').first()).toBeVisible();
	expect(await page.evaluate(key=>localStorage.getItem(key),introKey)).toBe('1');
});
