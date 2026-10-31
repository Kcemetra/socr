import {handleGeminiRequest} from '../server/gemini.js';
export async function GET(request){return handleGeminiRequest(request);}
export async function POST(request){return handleGeminiRequest(request);}
