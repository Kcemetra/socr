import {handleGeminiRequest} from '../../server/gemini.js';
export default async (request,context)=>handleGeminiRequest(request);
export const config={path:'/api/gemini'};
