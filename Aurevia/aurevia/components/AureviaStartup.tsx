'use client';

import Image from 'next/image';
import {useCallback,useEffect,useRef,useState} from 'react';
import {LoaderCircle} from 'lucide-react';
import AureviaLoading from '@/components/AureviaLoading';

type Orientation='landscape'|'portrait';

const introVideos={
	landscape:'/Videos/aurevia-intro-desktop.mp4',
	portrait:'/Videos/aurevia-intro-mobile.mp4',
};

export default function AureviaStartup({isVisible,isExiting,onSkip,onReplay}:{isVisible:boolean;isExiting:boolean;onSkip:()=>void;onReplay:()=>void}){
	const skipButton=useRef<HTMLButtonElement>(null);
	const replayButton=useRef<HTMLButtonElement>(null);
	const videoRef=useRef<HTMLVideoElement>(null);
	const wasVisible=useRef(false);
	const [orientation,setOrientation]=useState<Orientation|null>(null);
	const [sourceIndex,setSourceIndex]=useState(0);
	const [playbackIssue,setPlaybackIssue]=useState<'blocked'|'unavailable'|null>(null);
	const [loading,setLoading]=useState(true);
	const [loadAttempt,setLoadAttempt]=useState(0);

	useEffect(()=>{
		const portraitQuery=window.matchMedia('(orientation: portrait)');
		const updateOrientation=()=>setOrientation(portraitQuery.matches?'portrait':'landscape');
		updateOrientation();
		portraitQuery.addEventListener('change',updateOrientation);
		return()=>portraitQuery.removeEventListener('change',updateOrientation);
	},[]);

	useEffect(()=>{
		if(isVisible){
			wasVisible.current=true;
			skipButton.current?.focus({preventScroll:true});
		}else if(wasVisible.current){
			wasVisible.current=false;
			replayButton.current?.focus({preventScroll:true});
		}
	},[isVisible]);

	useEffect(()=>{
		if(!isVisible)return;
		setSourceIndex(0);
		setPlaybackIssue(null);
		setLoading(true);
	},[isVisible,orientation]);

	const preferredSource=orientation?introVideos[orientation]:null;
	const fallbackSource=orientation?introVideos[orientation==='portrait'?'landscape':'portrait']:null;
	const source=sourceIndex===0?preferredSource:fallbackSource;

	const playVideo=useCallback(async(video:HTMLVideoElement|null=videoRef.current)=>{
		if(!isVisible||!video)return;
		video.muted=true;
		try{
			await video.play();
			if(videoRef.current===video){
				setPlaybackIssue(null);
				setLoading(false);
			}
		}catch{
			if(videoRef.current===video){
				setPlaybackIssue('blocked');
				setLoading(false);
			}
		}
	},[isVisible]);

	useEffect(()=>{
		if(!isVisible||!source)return;
		const video=videoRef.current;
		if(!video)return;
		setLoading(true);
		setPlaybackIssue(null);
		video.load();
		void playVideo(video);
	},[isVisible,source,loadAttempt,playVideo]);

	function retryVideo(){
		setSourceIndex(0);
		setPlaybackIssue(null);
		setLoading(true);
		setLoadAttempt(value=>value+1);
	}

	if(!isVisible)return <button className="exchange-intro-replay" type="button" onClick={onReplay} ref={replayButton}>Replay video</button>;

	return <div className={`exchange-intro${isExiting?' is-exiting':''}`} role="dialog" aria-modal="true" aria-label="Aurevia Exchange introduction">
		<div className="exchange-intro-glow" aria-hidden="true"/>
		<Image className="exchange-intro-poster" src="/aurevia-logo.png" alt="" aria-hidden="true" width={512} height={512} priority sizes="(max-width: 600px) 58vw, 320px"/>
		{source&&<video
			key={`${source}:${loadAttempt}`}
			ref={videoRef}
			className="exchange-intro-video"
			src={source}
			autoPlay
			muted
			playsInline
			preload="auto"
			poster="/aurevia-logo.png"
			onLoadStart={()=>setLoading(true)}
			onLoadedData={()=>setLoading(false)}
			onCanPlay={event=>void playVideo(event.currentTarget)}
			onPlaying={()=>{setPlaybackIssue(null);setLoading(false)}}
			onWaiting={()=>setLoading(true)}
			onEnded={onSkip}
			onTimeUpdate={event=>{
				if(event.currentTarget.currentTime>=7){
					event.currentTarget.pause();
					onSkip();
				}
			}}
			onError={()=>{
				if(sourceIndex===0&&fallbackSource){
					setSourceIndex(1);
					setPlaybackIssue(null);
					setLoading(true);
					return;
				}
				setPlaybackIssue('unavailable');
				setLoading(false);
			}}
		/>}
		{loading&&!playbackIssue&&<div className="exchange-intro-loader" role="status"><LoaderCircle size={22} className="animate-spin" aria-hidden="true"/><span>Preparing your introduction</span></div>}
		<div className="exchange-intro-brand" aria-hidden="true"><span>AUREVIA</span><small>EXCHANGE</small></div>
		<button className="exchange-intro-skip" type="button" onClick={()=>{
			videoRef.current?.pause();
			onSkip();
		}} ref={skipButton}>Skip intro</button>
		{playbackIssue&&<div className="exchange-intro-actions">
			<p role="status">{playbackIssue==='unavailable'?'The introduction video could not be loaded.':'Tap to start the introduction.'}</p>
			<div className="exchange-intro-action-buttons">
				{playbackIssue==='blocked'?<>
					<button type="button" onClick={()=>void playVideo()}>Play video</button>
					<button type="button" className="is-secondary" onClick={retryVideo}>Retry video</button>
				</>:<>
					<button type="button" onClick={retryVideo}>Retry video</button>
					<button type="button" className="is-secondary" onClick={onSkip}>Continue to Aurevia</button>
				</>}
			</div>
		</div>}
	</div>;
}

export function AureviaStartupLoader({isExiting}:{isExiting:boolean}){
	return <AureviaLoading
		variant="screen"
		label="Loading Aurevia Exchange"
		detail="Restoring your workspace"
		className={`startup-screen${isExiting?' is-exiting':''}`}
	/>;
}
