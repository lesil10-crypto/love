export default async function handler(request, response) {
  // 1. POST 요청이 아니거나 body가 없으면 차단
  if (request.method !== 'POST' || !request.body) {
    return response.status(400).json({ error: 'POST request and body are required.' });
  }

  // 2. Vercel 환경 변수에서 Google API 키를 가져옵니다.
  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
  if (!GOOGLE_API_KEY) {
    return response.status(500).json({ error: 'API key is not configured.' });
  }

  // 3. 프론트엔드에서 보낸 데이터를 꺼냅니다.
  const { googleApiUrl, payload } = request.body;
  const fullGoogleApiUrl = `${googleApiUrl}?key=${GOOGLE_API_KEY}`;

  try {
    // 4. 이 백엔드 함수가 프론트엔드를 대신하여 "진짜" Google API를 호출합니다.
    const googleResponse = await fetch(fullGoogleApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!googleResponse.ok) {
      const errorText = await googleResponse.text();
      // Google에서 받은 오류를 그대로 프론트엔드에 전달
      return response.status(googleResponse.status).json({ error: 'Google API Error', details: errorText });
    }

    // 5. Google의 응답을 프론트엔드로 다시 전달합니다.
    const data = await googleResponse.json();
    return response.status(200).json(data);

  } catch (error) {
    return response.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
