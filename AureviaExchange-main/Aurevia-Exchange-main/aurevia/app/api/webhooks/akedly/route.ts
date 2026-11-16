import {NextResponse} from 'next/server';

export async function POST(){
	return NextResponse.json({error:'This legacy verification webhook is no longer active.'},{status:410});
}
