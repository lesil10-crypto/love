// 이 파일은 Vercel에서만 실행되는 '서버' 코드입니다.
// 주소는 /api/callGemini 가 됩니다.

export default async function handler(request, response) {
  // 1. POST 방식의 요청만 받습니다.
  if (request.method !== 'POST') {
    return response.status(405).send('Method Not Allowed');
  }

  // 2. Vercel에 안전하게 숨겨둔 '환경 변수'에서 API 키를 가져옵니다.
  // (코드에는 키가 전혀 들어가지 않습니다.)
  const GEMINI_API_KEY = process.env.USER_GEMINI_API_KEY;

  if (!GEMINI_API_KEY) {
    return response.status(500).json({ error: '서버에 API 키가 설정되지 않았습니다.' });
  }

  // 3. 사용자의 브라우저(script.js)가 보낸 요청 내용을 받습니다.
  const { googleApiUrl, payload } = request.body;

  try {
    // 4. 이 '서버'가 비밀 키를 사용해 *대신* Google에 요청을 보냅니다.
    const apiResponse = await fetch(`${googleApiUrl}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await apiResponse.json();

    // 5. Google의 응답 결과를 다시 사용자의 브라우저로 돌려줍니다.
    return response.status(apiResponse.status).json(data);

  } catch (error) {
    console.error("백엔드 에러:", error);
    return response.status(500).json({ error: 'Internal server error' });
  }
}