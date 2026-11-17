import {expect,test} from '@playwright/test';

const videoUrl='/Videos/aurevia-intro-desktop.mp4';
const items=[
	{
		id:'video-story',
		title:'Aurevia market briefing video',
		summary:'A video briefing with a readable summary.',
		canonicalUrl:videoUrl,
		publisher:'Aurevia Editorial',
		category:'VIDEO',
		publishedAt:'2026-11-17T07:00:00.000Z',
		thumbnailUrl:null,
		contentType:'editorial-link',
		mediaSource:{kind:'video',url:videoUrl},
		source:{key:'aurevia',displayName:'Aurevia Editorial',providerType:'EDITORIAL'},
	},
	{
		id:'embed-story',
		title:'Market perspective from our video partners',
		summary:'This supported provider embed keeps its native player controls.',
		canonicalUrl:'https://youtu.be/AbCdEf_1234',
		publisher:'Video Partner',
		category:'MARKET_NEWS',
		publishedAt:'2026-11-17T06:00:00.000Z',
		thumbnailUrl:null,
		contentType:'editorial-link',
		mediaSource:{kind:'embed',url:'https://www.youtube-nocookie.com/embed/AbCdEf_1234'},
		source:{key:'partner',displayName:'Video Partner',providerType:'EDITORIAL'},
	},
];

async function mockNewsFeed(page:import('@playwright/test').Page){
	await page.route(/\/api\/news-feed(?:\?|$)/,route=>route.fulfill({
		status:200,
		contentType:'application/json',
		body:JSON.stringify({items,page:1,pageSize:12,total:items.length,hasMore:false,stale:false,lastSuccessAt:null,sources:[]}),
	}));
}

test('news cards and video players fit phone, tablet, and desktop widths',async({page})=>{
	await mockNewsFeed(page);
	await page.setViewportSize({width:320,height:900});
	await page.goto('/news');
	const cards=page.locator('.news-feed-item');
	await expect(cards).toHaveCount(2);
	for(const width of [320,375,390,430,768,1024,1440]){
		await page.setViewportSize({width,height:900});
		const geometry=await page.evaluate(()=>{
			const main=document.querySelector<HTMLElement>('.news-editorial-page');
			const card=document.querySelector<HTMLElement>('.news-feed-item');
			const frame=document.querySelector<HTMLElement>('.news-feed-media-frame');
			if(!main||!card||!frame)throw new Error('News layout elements are missing.');
			return {
				scrollWidth:document.documentElement.scrollWidth,
				viewportWidth:window.innerWidth,
				mainWidth:main.getBoundingClientRect().width,
				cardWidth:card.getBoundingClientRect().width,
				frameWidth:frame.getBoundingClientRect().width,
				frameHeight:frame.getBoundingClientRect().height,
			};
		});
		expect(geometry.scrollWidth,`horizontal overflow at ${width}px`).toBeLessThanOrEqual(geometry.viewportWidth);
		expect(geometry.mainWidth).toBeGreaterThan(Math.min(width-40,1120)*.95);
		expect(geometry.cardWidth).toBeGreaterThan(geometry.mainWidth*.4);
		expect(geometry.frameWidth).toBeGreaterThan(geometry.cardWidth*.75);
		expect(geometry.frameHeight/geometry.frameWidth).toBeCloseTo(9/16,1);
		await expect(page.getByTitle('Market perspective from our video partners video')).toBeVisible();
		await expect(page.getByText('A video briefing with a readable summary.')).toBeVisible();
	}
});

test('direct video reports loading errors, retries, plays, pauses, mutes, fullscreen, and replays',async({page})=>{
	await mockNewsFeed(page);
	let firstVideoRequest=true;
	await page.route('**/Videos/aurevia-intro-desktop.mp4',route=>{
		if(firstVideoRequest){
			firstVideoRequest=false;
			return route.abort();
		}
		return route.continue();
	});

	await page.setViewportSize({width:390,height:844});
	await page.goto('/news');
	const player=page.getByRole('group',{name:'Aurevia market briefing video'});
	await expect(player.getByRole('alert')).toContainText('This video could not be loaded or played.');
	await player.getByRole('button',{name:'Retry video'}).click();

	const video=player.locator('video');
	await expect.poll(()=>video.evaluate(element=>(element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
	await player.getByRole('button',{name:'Play video',exact:true}).click();
	await expect(player.getByRole('status')).toHaveText('Playing');
	await expect.poll(()=>video.evaluate(element=>(element as HTMLVideoElement).currentTime)).toBeGreaterThan(.2);

	await player.getByRole('button',{name:'Mute video'}).click();
	await expect(video).toHaveJSProperty('muted',true);
	await player.getByRole('button',{name:'Unmute video'}).click();
	await expect(video).toHaveJSProperty('muted',false);
	await player.getByRole('button',{name:'Pause video'}).click();
	await expect.poll(()=>video.evaluate(element=>(element as HTMLVideoElement).paused)).toBe(true);

	const replaySeek=video.evaluate(element=>new Promise<boolean>(resolve=>element.addEventListener('seeked',()=>resolve((element as HTMLVideoElement).currentTime<.5),{once:true})));
	await player.getByRole('button',{name:'Replay video'}).click();
	expect(await replaySeek).toBe(true);
	await expect.poll(()=>video.evaluate(element=>(element as HTMLVideoElement).currentTime)).toBeGreaterThan(.2);
	await player.getByRole('button',{name:'Fullscreen video'}).click();
	await expect.poll(()=>page.evaluate(()=>Boolean(document.fullscreenElement))).toBe(true);
	await page.keyboard.press('Escape');
});
