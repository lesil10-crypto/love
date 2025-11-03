// 파일 경로: /api/fetchImage.js

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { imageUrl } = req.body;

    if (!imageUrl) {
        return res.status(400).json({ error: 'imageUrl is required' });
    }

    try {
        // 서버(Vercel)에서 이미지 URL로 fetch 요청 (CORS 문제 없음)
        const response = await fetch(imageUrl);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
        }

        // 이미지를 ArrayBuffer로 읽어옴
        const buffer = await response.arrayBuffer();
        
        // ArrayBuffer를 Base64 문자열로 변환
        const base64 = Buffer.from(buffer).toString('base64');
        
        // 클라이언트에 base64 데이터 전송
        res.status(200).json({ base64 });

    } catch (error) {
        console.error('Error fetching image:', error.message);
        res.status(500).json({ error: 'Failed to proxy image', details: error.message });
    }
}