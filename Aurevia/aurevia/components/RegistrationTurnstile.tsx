'use client';

import {useEffect,useRef,useState} from 'react';

type TurnstileApi={
	render:(container:HTMLElement,options:Record<string,unknown>)=>string;
	remove:(widgetId:string)=>void;
	reset:(widgetId:string)=>void;
};

declare global{
	interface Window{turnstile?:TurnstileApi}
}

let scriptPromise:Promise<void>|null=null;

function loadTurnstileScript(){
	if(typeof window==='undefined')return Promise.reject(new Error('TURNSTILE_BROWSER_REQUIRED'));
	if(window.turnstile)return Promise.resolve();
	if(scriptPromise)return scriptPromise;
	const pending=new Promise<void>((resolve,reject)=>{
		const existing=document.querySelector<HTMLScriptElement>('script[data-aurevia-turnstile]');
		const script=existing||document.createElement('script');
		script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
		script.async=true;
		script.defer=true;
		script.dataset.aureviaTurnstile='true';
		script.onload=()=>window.turnstile?resolve():reject(new Error('TURNSTILE_API_UNAVAILABLE'));
		script.onerror=()=>reject(new Error('TURNSTILE_SCRIPT_UNAVAILABLE'));
		if(!existing)document.head.appendChild(script);
	});
	const tracked=pending.catch(error=>{
		if(scriptPromise===tracked)scriptPromise=null;
		document.querySelector('script[data-aurevia-turnstile]')?.remove();
		throw error;
	});
	scriptPromise=tracked;
	return tracked;
}

export default function RegistrationTurnstile({siteKey,onToken}:{siteKey:string;onToken:(token:string|null)=>void}){
	const containerRef=useRef<HTMLDivElement>(null);
	const tokenHandler=useRef(onToken);
	const [state,setState]=useState<'loading'|'ready'|'expired'|'error'>(siteKey?'loading':'error');
	const [attempt,setAttempt]=useState(0);

	useEffect(()=>{tokenHandler.current=onToken},[onToken]);

	useEffect(()=>{
		if(!siteKey)return;
		let active=true;
		let widgetId:string|undefined;
		setState('loading');
		void loadTurnstileScript().then(()=>{
			if(!active||!containerRef.current||!window.turnstile)return;
			widgetId=window.turnstile.render(containerRef.current,{
				sitekey:siteKey,
				theme:'dark',
				size:'flexible',
				action:'register',
				callback:(token:string)=>{tokenHandler.current(token);setState('ready')},
				'expired-callback':()=>{tokenHandler.current(null);setState('expired')},
				'error-callback':()=>{tokenHandler.current(null);setState('error');return true},
			});
			setState('ready');
		}).catch(()=>{if(active)setState('error')});
		return()=>{
			active=false;
			if(widgetId&&window.turnstile)window.turnstile.remove(widgetId);
		};
	},[siteKey,attempt]);

	function retry(){
		tokenHandler.current(null);
		setState('loading');
		setAttempt(value=>value+1);
	}

	return <div className="registration-turnstile" aria-label="Cloudflare security check">
		<div ref={containerRef} className="min-h-[65px]"/>
		{state==='loading'&&<p className="text-xs muted" role="status">Loading security check…</p>}
		{state==='expired'&&<p className="text-xs muted" role="status">Verification expired. Complete the security check again.</p>}
		{state==='error'&&<div className="flex items-center gap-3">
			<p className="text-xs text-loss" role="alert">Cloudflare security check could not connect. Check your connection or try again.</p>
			<button type="button" className="text-xs underline" onClick={retry}>Retry security check</button>
		</div>}
	</div>;
}
