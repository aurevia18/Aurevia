'use client';

import {useCallback,useEffect,useState} from 'react';
import {LoaderCircle,RefreshCw,ShieldCheck} from 'lucide-react';

type DiditStatus={
	enabled:boolean;
	configured:boolean;
	environment:'sandbox'|'production'|null;
	latestSession:{sessionId:string|null;status:string;environment:string;createdAt:string;completedAt:string|null}|null;
};

const statusLabels:Record<string,string>={
	'Approved':'Approved',
	'Declined':'Declined',
	'In Review':'In review',
	'In Progress':'In progress',
	'Not Started':'Not started',
	'Expired':'Expired',
	'Abandoned':'Abandoned',
	'Kyc Expired':'Expired',
	'Resubmitted':'Resubmitted',
	'Awaiting User':'Action required',
};

export default function DiditKycPanel(){
	const [status,setStatus]=useState<DiditStatus|null>(null);
	const [loading,setLoading]=useState(true);
	const [starting,setStarting]=useState(false);
	const [error,setError]=useState('');

	const load=useCallback(async()=>{
		try{
			const response=await fetch('/api/kyc/didit-session',{cache:'no-store'});
			const result=await response.json();
			if(!response.ok)throw new Error(result.error||'Unable to load Didit verification status.');
			setStatus(result as DiditStatus);
			setError('');
		}catch(exception){
			setError(exception instanceof Error?exception.message:'Unable to load Didit verification status.');
		}finally{
			setLoading(false);
		}
	},[]);

	useEffect(()=>{
		void load();
		const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load()},60_000);
		window.addEventListener('focus',load);
		return()=>{window.clearInterval(timer);window.removeEventListener('focus',load)};
	},[load]);

	async function startVerification(){
		if(starting)return;
		setStarting(true);
		setError('');
		try{
			const response=await fetch('/api/kyc/didit-session',{method:'POST'});
			const result=await response.json();
			if(!response.ok)throw new Error(result.error||'Unable to start Didit identity verification.');
			const verificationUrl=new URL(result.url);
			if(verificationUrl.origin!=='https://verify.didit.me')throw new Error('Didit returned an unexpected verification URL.');
			window.location.assign(verificationUrl.toString());
		}catch(exception){
			setError(exception instanceof Error?exception.message:'Unable to start Didit identity verification.');
			setStarting(false);
		}
	}

	if(loading&&!status)return <section className="account-panel card mt-4 p-5" aria-labelledby="didit-title"><h2 id="didit-title" className="text-lg font-semibold">Didit identity verification</h2><p className="mt-2 text-sm muted" role="status">Loading provider status…</p></section>;

	return <section className="account-panel card mt-4 p-5" aria-labelledby="didit-title">
		<div className="flex flex-wrap items-start justify-between gap-3">
			<div><h2 id="didit-title" className="text-lg font-semibold">Didit identity verification</h2><p className="mt-1 text-sm leading-6 muted">Identity review is independent from your email and phone verification status.</p></div>
			{status?.latestSession&&<span className="status-pill">{statusLabels[status.latestSession.status]||status.latestSession.status}</span>}
		</div>
		{status?.latestSession&&<p className="mt-3 text-sm muted">Started {new Date(status.latestSession.createdAt).toLocaleString()} · {status.latestSession.environment} environment{status.latestSession.completedAt?` · Updated ${new Date(status.latestSession.completedAt).toLocaleString()}`:''}</p>}
		{error&&<p className="mt-3 text-sm text-loss" role="alert">{error}</p>}
		{status?.enabled&&status.configured?<div className="mt-4 flex flex-wrap items-center gap-3">
			<button className="btn min-h-11 bg-gold px-4 text-black disabled:opacity-50" type="button" disabled={starting} onClick={()=>void startVerification()}>{starting?<><LoaderCircle size={16} className="animate-spin"/>Starting verification…</>:<><ShieldCheck size={16}/>{status.latestSession?'Start a new Didit session':'Start identity verification'}</>}</button>
			<button className="btn min-h-11 bg-white/10" type="button" disabled={loading} onClick={()=>void load()}><RefreshCw size={15}/>Refresh status</button>
			{status.environment==='sandbox'&&<span className="text-xs muted">Sandbox environment</span>}
		</div>:<p className="mt-3 text-sm muted">{status?.enabled?'Didit is enabled but is missing required server configuration.':'Didit verification is not currently enabled.'} Your existing Aurevia verification records remain available.</p>}
	</section>;
}
