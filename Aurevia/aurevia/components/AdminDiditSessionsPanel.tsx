'use client';

import {useCallback,useEffect,useState} from 'react';

type DiditEvent={eventId:string;webhookType:string;createdAt:string;receivedAt:string};
type DiditSession={
	id:string;
	sessionId:string|null;
	status:string;
	environment:string;
	lastEventAt:string|null;
	completedAt:string|null;
	createdAt:string;
	user:{id:string;name:string|null;email:string;accountMode:string;status:string};
	events:DiditEvent[];
};
type PageResult={items:DiditSession[];total:number;page:number;totalPages:number};

export default function AdminDiditSessionsPanel(){
	const [result,setResult]=useState<PageResult|null>(null);
	const [page,setPage]=useState(1);
	const [loading,setLoading]=useState(true);
	const [error,setError]=useState('');

	const load=useCallback(async()=>{
		setLoading(true);
		try{
			const response=await fetch(`/api/admin/kyc/didit-sessions?page=${page}`,{cache:'no-store'});
			const payload=await response.json();
			if(!response.ok)throw new Error(payload.error||'Unable to load Didit sessions.');
			setResult(payload as PageResult);
			setError('');
		}catch(exception){
			setError(exception instanceof Error?exception.message:'Unable to load Didit sessions.');
		}finally{
			setLoading(false);
		}
	},[page]);

	useEffect(()=>{void load()},[load]);

	return <section className="account-panel card mt-4 p-5" aria-labelledby="didit-admin-title">
		<div className="flex flex-wrap items-start justify-between gap-3">
			<div><h2 id="didit-admin-title" className="text-lg font-semibold">Didit verification sessions</h2><p className="mt-1 text-sm muted">Provider status and signed webhook delivery history. Identity decision payloads are not displayed.</p></div>
			<button className="btn min-h-10 bg-white/10" type="button" disabled={loading} onClick={()=>void load()}>{loading?'Refreshing…':'Refresh'}</button>
		</div>
		{error&&<p className="mt-4 text-sm text-loss" role="alert">{error}</p>}
		{loading&&!result?<p className="mt-4 text-sm muted" role="status">Loading Didit sessions…</p>:result?.items.length?<div className="mt-4 overflow-x-auto">
			<table className="w-full min-w-[760px] text-left text-sm">
				<thead><tr className="border-b border-white/10"><th className="py-2 pr-4">Account</th><th className="py-2 pr-4">Provider status</th><th className="py-2 pr-4">Environment</th><th className="py-2 pr-4">Session</th><th className="py-2">Webhook history</th></tr></thead>
				<tbody>{result.items.map(session=><tr className="border-b border-white/10 align-top" key={session.id}>
					<td className="py-3 pr-4"><span className="block">{session.user.name||'Unnamed account'}</span><span className="text-xs muted">{session.user.email}</span><span className="block text-xs muted">{session.user.accountMode} · {session.user.status}</span></td>
					<td className="py-3 pr-4"><span>{session.status}</span><span className="block text-xs muted">{session.completedAt?`Completed ${new Date(session.completedAt).toLocaleString()}: `:''}{new Date(session.createdAt).toLocaleString()}</span></td>
					<td className="py-3 pr-4">{session.environment}</td>
					<td className="py-3 pr-4"><code className="text-xs">{session.sessionId||'Unavailable'}</code></td>
					<td className="py-3">{session.events.length?session.events.map(event=><span className="mb-1 block text-xs" key={event.eventId}>{event.webhookType} · received {new Date(event.receivedAt).toLocaleString()}</span>):<span className="text-xs muted">No webhook events recorded</span>}</td>
				</tr>)}</tbody>
			</table>
		</div>:!error?<p className="mt-4 text-sm muted">No Didit verification sessions have been recorded.</p>:null}
		{result&&result.totalPages>1&&<div className="mt-4 flex items-center justify-between text-sm"><span className="muted">{result.total} sessions · page {result.page} of {result.totalPages}</span><div className="flex gap-2"><button className="btn min-h-9 bg-white/10" type="button" disabled={loading||page<=1} onClick={()=>setPage(value=>Math.max(1,value-1))}>Previous</button><button className="btn min-h-9 bg-white/10" type="button" disabled={loading||page>=result.totalPages} onClick={()=>setPage(value=>Math.min(result.totalPages,value+1))}>Next</button></div></div>}
	</section>;
}
