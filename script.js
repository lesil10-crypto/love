import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, addDoc, writeBatch, query, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject, uploadBytes } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// === Firebase 설정 (최종 확인 완료) ===
const USER_FIREBASE_CONFIG = {
    apiKey: "AIzaSyC-UisM1j624UWaQESMGCtYAuvkimpjBI8", // 새로 발급받은 키 (웹사이트 제한 설정 필수)
    authDomain: "projec-48c55.firebaseapp.com",
    projectId: "projec-48c55", // 확인된 프로젝트 ID
    storageBucket: "projec-48c55.appspot.com", // 기본 스토리지 버킷 주소
    messagingSenderId: "376464552007",
    appId: "1:376464552007:web:929b53196fc86af19dc162",
    measurementId: "G-HMKJMNFGM4"
};

// 0. 초기 변수 선언
let searchInput, searchButton, loadingContainer, loadingText, progressBar, searchBarContainer,
    printContainer, printContentArea, modalContainer, modalContent, imageModalContainer,
    modalImage, wordTooltip, fileModalContainer, fileUploadInput, fileUploadButton,
    listModalContainer, listModalTitle, listModalContent, sortOptions, markReadBtn,
    markUnreadBtn, deleteSelectedBtn, confirmCallback, confirmationModal,
    confirmationMessage, confirmOkBtn, confirmCancelBtn,
    searchChoiceModal, searchChoiceWord, searchChoiceLoadSavedBtn, 
    searchChoiceNewSearchBtn, searchChoiceCancelBtn,
    currentChoicePageData;

// 텍스트 생성용 Gemini API URL
const textApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent`;

const translationCache = {};

// Firebase 서비스 인스턴스
let db, auth, storage, userId;
let app;
const appId = 'default-ai-vocab-app';

// 탭 및 데이터 관리
let tabs = {};
let activeTabId = null;
let tabCounter = 0;
let savedWords = [];
let savedSentences = [];

// =========================================================================
// === 1. 이미지 생성 함수 (Pollinations Flux 모델) ===
// =========================================================================

async function callImagenWithRetry(prompt, retries = 3) {
    try {
        // 프롬프트 길이 제한 (오류 방지)
        const safePrompt = prompt.length > 400 ? prompt.substring(0, 400) : prompt;
        const encodedPrompt = encodeURIComponent(safePrompt);
        const randomSeed = Math.floor(Math.random() * 100000);
        
        // 고품질 Flux 모델 요청
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=flux&nologo=true&seed=${randomSeed}`;

        // 이미지 Fetch (Blob으로 변환하여 저장 기능 지원)
        const response = await fetch(imageUrl);
        if (!response.ok) {
            throw new Error(`Image generation failed: ${response.status}`);
        }
        
        const blob = await response.blob();
        
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                resolve({ url: reader.result, status: 'success' });
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });

    } catch (e) {
        console.error("Image generation failed:", e);
        return { 
            url: `https://placehold.co/1024x1024/e0e5ec/4a5568?text=Image+Generation+Failed`, 
            status: 'failed' 
        };
    }
}

// =========================================================================
// === 2. Gemini API 호출 (직접 호출 방식) ===
// =========================================================================

async function callGemini(prompt, isJson = false, base64Image = null) {
    // API 키를 URL 파라미터로 직접 사용 (백엔드 없는 환경 지원)
    const apiKey = USER_FIREBASE_CONFIG.apiKey;
    const url = `${textApiUrl}?key=${apiKey}`;

    const parts = [{ text: prompt }];
    if (base64Image) {
        parts.push({
            inlineData: {
                mimeType: "image/png",
                data: base64Image
            }
        });
    }

    const payload = { contents: [{ parts: parts }] };
    
    // JSON 응답 강제 설정
    if (isJson) { 
        payload.generationConfig = { responseMimeType: "application/json" }; 
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini API Error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!text) throw new Error("Gemini API response is empty.");

        // JSON 파싱 처리
        if (isJson) {
            let jsonString = text.trim();
            // 마크다운 코드 블록 제거
            if (jsonString.startsWith("```json")) { jsonString = jsonString.slice(7, -3).trim(); }
            else if (jsonString.startsWith("```")) { jsonString = jsonString.slice(3, -3).trim(); }
            
            try { return JSON.parse(jsonString); }
            catch (error) { 
                console.error("JSON Parsing Failed:", error); 
                throw error; 
            }
        }
        return text;

    } catch (error) {
        console.error("Gemini API Call Failed:", error);
        throw error;
    }
}

// =========================================================================
// === 3. Firebase 및 UI 초기화 ===
// =========================================================================

async function initializeFirebase() {
    // DOM 요소 연결
    searchInput = document.getElementById('search-input');
    searchButton = document.getElementById('search-button');
    loadingContainer = document.getElementById('loading-container');
    loadingText = document.getElementById('loading-text');
    progressBar = document.getElementById('progress-bar');
    searchBarContainer = document.getElementById('search-bar-container');
    printContainer = document.getElementById('print-container');
    printContentArea = document.getElementById('print-content-area');
    modalContainer = document.getElementById('modal-container');
    modalContent = document.getElementById('modal-content');
    imageModalContainer = document.getElementById('image-modal-container');
    modalImage = document.getElementById('modal-image');
    wordTooltip = document.getElementById('word-tooltip');
    fileModalContainer = document.getElementById('file-modal-container');
    fileUploadInput = document.getElementById('file-upload-input');
    fileUploadButton = document.getElementById('file-upload-button');
    listModalContainer = document.getElementById('list-modal-container');
    listModalTitle = document.getElementById('list-modal-title');
    listModalContent = document.getElementById('list-modal-content');
    sortOptions = document.getElementById('sort-options');
    markReadBtn = document.getElementById('mark-read-btn');
    markUnreadBtn = document.getElementById('mark-unread-btn');
    deleteSelectedBtn = document.getElementById('delete-selected-btn');
    confirmationModal = document.getElementById('confirmation-modal');
    confirmationMessage = document.getElementById('confirmation-message');
    confirmOkBtn = document.getElementById('confirm-ok-btn');
    confirmCancelBtn = document.getElementById('confirm-cancel-btn');

    searchChoiceModal = document.getElementById('search-choice-modal');
    searchChoiceWord = document.getElementById('search-choice-word');
    searchChoiceLoadSavedBtn = document.getElementById('search-choice-load-saved-btn');
    searchChoiceNewSearchBtn = document.getElementById('search-choice-new-search-btn');
    searchChoiceCancelBtn = document.getElementById('search-choice-cancel-btn');

    try {
        app = initializeApp(USER_FIREBASE_CONFIG);
        db = getFirestore(app);
        auth = getAuth(app);
        storage = getStorage(app); // config의 storageBucket 자동 사용
        setLogLevel('error'); 
          
        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                document.getElementById('auth-status').innerHTML = `
                    <span class="text-sm">환영합니다, ${user.displayName || '사용자'}님</span>
                    <button id="google-logout-btn" class="btn-3d !p-2 !text-xs !bg-red-400 !text-white hover:!bg-red-500">로그아웃</button>
                `;
                document.getElementById('google-logout-btn').onclick = () => signOut(auth);
                
                document.getElementById('app-container').style.visibility = 'visible';
                document.getElementById('auth-container').classList.add('hidden');
                
                searchInput.disabled = false;
                searchInput.classList.remove('cursor-pointer', 'disabled:cursor-not-allowed');
                searchInput.placeholder = "영단어 또는 한글 뜻을 입력하세요...";

                loadUserLists();
                listenForFiles();

            } else {
                userId = null;
                document.getElementById('auth-status').innerHTML = `<span class="text-sm">로그인이 필요합니다.</span>`;
                
                document.getElementById('app-container').style.visibility = 'hidden';
                document.getElementById('auth-container').classList.remove('hidden');

                searchInput.disabled = true;
                searchInput.classList.add('cursor-pointer', 'disabled:cursor-not-allowed');
                searchInput.placeholder = "Google 로그인이 필요합니다...";

                savedWords = [];
                savedSentences = [];
                renderFileList([]);
            }
            safeCreateIcons();
        });

    } catch (error) {
        console.error("Firebase Init Error: ", error);
        showToast("데이터베이스 연결 실패", "error");
    }

    // UI 이벤트 리스너 등록
    confirmOkBtn.addEventListener('click', () => { if (confirmCallback) confirmCallback(); hideConfirmationModal(); });
    confirmCancelBtn.addEventListener('click', hideConfirmationModal);

    searchChoiceLoadSavedBtn.addEventListener('click', loadSavedPageFromChoice);
    searchChoiceNewSearchBtn.addEventListener('click', () => {
        executeSearchForWord(searchChoiceWord.textContent); 
        hideSearchChoiceModal();
    });
    searchChoiceCancelBtn.addEventListener('click', hideSearchChoiceModal);

    fileUploadButton.addEventListener('click', handleFileUpload);

    listModalContent.addEventListener('change', (e) => { if (e.target.classList.contains('item-checkbox')) updateListActionButtonsState(); });

    document.addEventListener('mouseover', handleWordHover);
    document.addEventListener('mouseout', (e) => { if (e.target.classList.contains('clickable-word')) wordTooltip.classList.add('hidden'); });
    document.addEventListener('click', handleWordClick);

    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && userId) handleSearch(searchInput.value.trim()); });
    
    document.getElementById('word-list-btn').addEventListener('click', () => showListModal('words'));
    document.getElementById('sentence-list-btn').addEventListener('click', () => showListModal('sentences'));
    document.getElementById('file-storage-btn').addEventListener('click', showFileModal);
    document.getElementById('share-btn').addEventListener('click', shareApp);
    
    sortOptions.addEventListener('change', (e) => { currentSort = e.target.value; renderList(); });
    markReadBtn.addEventListener('click', () => performBulkAction('mark-read'));
    markUnreadBtn.addEventListener('click', () => performBulkAction('mark-unread')); 
    deleteSelectedBtn.addEventListener('click', () => performBulkAction('delete'));
} 

// 파일 업로드 처리 함수
async function handleFileUpload() {
    if (!auth || !auth.currentUser) { showToast("로그인이 필요합니다.", "error"); return; } 
    const file = fileUploadInput.files[0]; 
    if (!file) { showToast("파일을 선택해주세요.", "warning"); return; } 
    
    // 파일 경로 설정
    const storagePath = `artifacts/${appId}/users/${userId}/files/${file.name}`; 
    const storageRef = ref(storage, storagePath); 
    
    const uploadProgressContainer = document.getElementById('upload-progress-container'); 
    const uploadProgressBar = document.getElementById('upload-progress-bar'); 
    uploadProgressContainer.classList.remove('hidden'); 
    fileUploadButton.disabled = true; 
    
    const uploadTask = uploadBytesResumable(storageRef, file); 
    
    uploadTask.on('state_changed', 
        (snapshot) => { 
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100; 
            uploadProgressBar.style.width = progress + '%'; 
        }, 
        (error) => { 
            console.error("Upload failed:", error); 
            showToast("업로드 실패", "error"); 
            uploadProgressContainer.classList.add('hidden'); 
            fileUploadButton.disabled = false; 
        }, 
        async () => { 
            try { 
                const metadata = uploadTask.snapshot.metadata; 
                await addDoc(collection(db, `artifacts/${appId}/users/${userId}/file_metadata`), { 
                    name: metadata.name, 
                    fullPath: metadata.fullPath, 
                    size: metadata.size, 
                    contentType: metadata.contentType, 
                    timestamp: new Date() 
                }); 
                showToast("업로드 성공!", "success");
            } catch (error) { 
                console.error("Metadata save error:", error); 
                showToast("정보 저장 실패", "error"); 
                // DB 저장 실패 시 업로드된 파일 정리
                await deleteObject(uploadTask.snapshot.ref).catch(e => console.error("Cleanup error:", e)); 
            } finally { 
                uploadProgressContainer.classList.add('hidden'); 
                fileUploadInput.value = ''; 
                fileUploadButton.disabled = false; 
            } 
        }
    ); 
}

// =========================================================================
// === 4. 검색 및 콘텐츠 생성 로직 ===
// =========================================================================

async function handleSearch(query) {
    if (!userId) { showToast("로그인이 필요합니다.", "error"); return; } 
    if (!query) { showToast("검색어를 입력해주세요.", "warning"); return; }
    
    const isKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(query);
    if (isKorean) {
        showLoader(0, `'${query}' 의미 확인 중...`);
        try {
            const prompt = `Translate Korean word "${query}" to English. If ambiguous, return JSON: {"is_ambiguous": true, "english_words": ["word1", "word2"]}. If not, {"is_ambiguous": false, "english_words": ["word1"]}.`;
            const data = await callGemini(prompt, true);
            const words = [...new Set(data.english_words.map(w => w.toLowerCase().trim()))];
            
            if (data.is_ambiguous && words.length > 1) {
                showToast(`'${query}'에 대한 ${words.length}가지 의미를 발견했습니다.`, "info");
                for (const word of words) await checkAndLoadPage(word);
            } else {
                await checkAndLoadPage(words[0] || query);
            }
        } catch (e) {
            console.error(e);
            await checkAndLoadPage(query);
        } finally { hideLoader(); }
    } else {
        await checkAndLoadPage(query);
    }
}

async function checkAndLoadPage(word) {
    if (!db || !userId) { executeSearchForWord(word); return; }
    const normalizedWord = word.toLowerCase();
    const pageRef = doc(db, `artifacts/${appId}/users/${userId}/saved_pages/${normalizedWord}`);
    
    try {
        const docSnap = await getDoc(pageRef);
        if (docSnap.exists()) {
            showSearchChoiceModal(word, docSnap.data().pageData);
        } else {
            executeSearchForWord(word);
        }
    } catch (error) {
        console.error("Check saved page error:", error);
        executeSearchForWord(word); 
    }
}

async function executeSearchForWord(wordQuery, makeActive = true) {
    const tabId = addTab(wordQuery, makeActive);
    const currentTab = tabs[tabId];
    currentTab.contentEl.innerHTML = '';
    const searchId = ++currentTab.searchId;
    currentTab.fullSearchResult = {};
    currentTab.imageLoadPromises = []; 
    
    showLoader(0, `"${wordQuery}" 분석 중...`);
    searchButton.disabled = true;

    try {
        // 1. 기본 정보 생성
        updateLoader(10, "기본 정보 생성 중...");
        const initialPrompt = `Create info for English word "${wordQuery}" in JSON: {"word": "...", "koreanMeaning": "...", "pronunciation": "...", "mainImagePrompt": "...", "episode": {"story": "...", "story_ko": "...", "imagePrompt": "..."}}`;
        const initialData = await callGemini(initialPrompt, true);
        
        initialData.word = initialData.word.toLowerCase();
        currentTab.fullSearchResult.initialData = initialData;
        
        if (searchId !== currentTab.searchId) return;
        updateLoader(25, "정보 표시 중...");
        
        renderPrintButton(currentTab);
        renderSavePageButton(currentTab); 
        
        const placeholderImg = "https://placehold.co/300x300/e0e5ec/4a5568?text=Loading...";
        renderBasicInfo(initialData, placeholderImg, currentTab.contentEl);
        renderEpisode(initialData, placeholderImg, currentTab.contentEl);
        addWordToHistory(initialData.word, initialData.koreanMeaning);
        
        // 2. 이미지 생성 (병렬 처리)
        const mainImagePromise = callImagenWithRetry(initialData.mainImagePrompt).then(res => {
            currentTab.fullSearchResult.mainImageUrl = res.url;
            const img = currentTab.contentEl.querySelector('#main-image');
            if (img) {
                img.src = res.url;
                img.onclick = () => showImageAnalysisModal(res.url, initialData.word, initialData.koreanMeaning);
            }
        });
        currentTab.imageLoadPromises.push(mainImagePromise);
        
        const episodeImagePromise = callImagenWithRetry(initialData.episode.imagePrompt).then(res => {
            currentTab.fullSearchResult.episodeImageUrl = res.url;
            const img = currentTab.contentEl.querySelector('#episode-image');
            if (img) {
                img.src = res.url;
                img.onclick = () => showImageModal(res.url);
            }
        });
        currentTab.imageLoadPromises.push(episodeImagePromise);

        // 3. 의미 분석 생성
        updateLoader(40, "의미 및 예문 생성 중...");
        const meaningsPrompt = `Analyze meanings for "${initialData.word}". JSON array: [{ "type": "...", "description": "...", "exampleSentence": "...", "exampleSentenceTranslation": "...", "imagePrompt": "..." }]`;
        const meaningsData = await callGemini(meaningsPrompt, true);
        currentTab.fullSearchResult.meaningsData = meaningsData;
        
        await renderMeanings(meaningsData, initialData.word, searchId, currentTab, currentTab.contentEl);
        
        renderSentenceCrafter(initialData.word, currentTab.contentEl);
        
        // 4. 심화 학습 정보
        updateLoader(75, "심화 정보 생성 중...");
        const divePrompt = `Deep dive for "${initialData.word}". JSON: {"quotes": [], "synonyms": [], "antonyms": [], "conceptTree": {}, "dialogue": [], "quiz": []}`;
        const diveData = await callGemini(divePrompt, true);
        currentTab.fullSearchResult.fastDeepDiveData = diveData;
        
        updateLoader(90, "마무리 중...");
        const buttonContainer = renderDeepDiveButtonsContainer(currentTab.contentEl);
        if(diveData.conceptTree) appendConceptTreeButton(buttonContainer, diveData.conceptTree);
        renderDeepDive(diveData, currentTab.contentEl);
        
        hideLoader();
        
        // 5. 백과사전 (비동기 로드)
        const wikiPrompt = `Write encyclopedia info for "${initialData.word}". JSON: {"encyclopedia": { "introduction": "...", "etymology": "...", "history": "...", "usage": "...", "introduction_ko": "...", "etymology_ko": "...", "history_ko": "...", "usage_ko": "..." }}`;
        callGemini(wikiPrompt, true).then(wikiData => {
            if (searchId === currentTab.searchId) {
                currentTab.fullSearchResult.encyclopediaData = wikiData;
                if(wikiData.encyclopedia) appendEncyclopediaButton(buttonContainer, wikiData.encyclopedia);
            }
        });

        // 저장 버튼 활성화
        Promise.all(currentTab.imageLoadPromises).then(() => {
            if (searchId === currentTab.searchId) {
                const saveBtn = document.getElementById(`save-page-btn-${currentTab.id}`);
                if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = `💾 이 페이지 저장하기`; }
                const printBtn = document.getElementById(`print-btn-${currentTab.id}`);
                if (printBtn) { printBtn.disabled = false; printBtn.innerHTML = `🖨️ 결과 인쇄하기`; }
            }
        });

    } catch (error) {
        console.error("Search failed:", error);
        showToast("콘텐츠 생성 중 오류가 발생했습니다.", "error");
        hideLoader();
    } finally {
        searchButton.disabled = false;
    }
}

// =========================================================================
// === 5. 데이터 저장 및 불러오기 ===
// =========================================================================

window.saveCurrentPage = async function(tabId) {
    const tab = tabs[tabId];
    if (!tab || !tab.fullSearchResult) return;
    
    const saveButton = document.getElementById(`save-page-btn-${tabId}`);
    saveButton.disabled = true;
    saveButton.innerHTML = `저장 중...`;

    try {
        const word = tab.fullSearchResult.initialData.word.toLowerCase();
        
        if (!userId) {
            showToast("로그인이 필요합니다.", "error");
            saveButton.disabled = false;
            saveButton.innerHTML = `💾 이 페이지 저장하기`;
            return;
        }
        
        const pageData = JSON.parse(JSON.stringify(tab.fullSearchResult)); 
        const imageUploads = [];

        // 이미지 Base64 -> Storage URL 변환 함수
        const processImg = async (url, path) => {
            if (url && url.startsWith('data:image')) {
                return await uploadBase64Image(url, path);
            }
            return url;
        };

        if (pageData.mainImageUrl) imageUploads.push(processImg(pageData.mainImageUrl, `saved_pages/${userId}/${word}/main.png`).then(u => pageData.mainImageUrl = u));
        if (pageData.episodeImageUrl) imageUploads.push(processImg(pageData.episodeImageUrl, `saved_pages/${userId}/${word}/episode.png`).then(u => pageData.episodeImageUrl = u));
        
        if (pageData.meaningsData) {
            pageData.meaningsData.forEach((m, i) => {
                if (m.imageUrl) imageUploads.push(processImg(m.imageUrl, `saved_pages/${userId}/${word}/meaning_${i}.png`).then(u => pageData.meaningsData[i].imageUrl = u));
            });
        }

        await Promise.all(imageUploads);

        const pageRef = doc(db, `artifacts/${appId}/users/${userId}/saved_pages/${word}`);
        await setDoc(pageRef, {
            word: word,
            savedAt: new Date(),
            pageData: pageData 
        });

        showToast("저장 완료!", "success");
        renderDeletePageButton(tab.contentEl, word, `save-page-btn-${tabId}`);
    } catch (error) {
        console.error("Save failed:", error);
        showToast("저장 실패", "error");
        saveButton.disabled = false;
        saveButton.innerHTML = `💾 이 페이지 저장하기`;
    }
}

window.deleteSavedPage = async function(word) {
    const normalizedWord = word.toLowerCase();
    showConfirmationModal(`'${normalizedWord}' 페이지를 삭제하시겠습니까?`, async () => {
        if (!db || !userId) return;
        try {
            await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/saved_pages/${normalizedWord}`));
            showToast("삭제되었습니다.", "success");
            
            const deleteButton = document.getElementById(`delete-page-btn-${normalizedWord}`);
            if(deleteButton) {
                const tabId = deleteButton.closest('[id^="tab-content-"]').id.replace('tab-content-', 'tab-');
                const saveButton = document.createElement('button');
                saveButton.id = `save-page-btn-${tabId}`;
                saveButton.className = 'btn-3d mb-4 ml-4';
                saveButton.innerHTML = `💾 이 페이지 저장하기`;
                saveButton.onclick = () => saveCurrentPage(tabId);
                deleteButton.replaceWith(saveButton);
                safeCreateIcons();
            }
        } catch (error) {
            console.error("Delete failed:", error);
            showToast("삭제 실패", "error");
        }
    });
}

// =========================================================================
// === 6. UI 렌더링 함수들 ===
// =========================================================================

function renderBasicInfo(data, imageUrl, container) {
    const html = `
    <div class="card p-6 mb-6">
        <div class="flex flex-col md:flex-row gap-6">
            <div class="w-full md:w-1/3">
                <img id="main-image" src="${imageUrl}" class="rounded-lg shadow-lg w-full object-cover cursor-pointer hover:opacity-95 transition">
            </div>
            <div class="w-full md:w-2/3">
                <div class="flex items-center gap-3 mb-2">
                    <h2 class="text-4xl font-bold text-gray-800">${data.word}</h2>
                    <button onclick="speak('${data.word}')" class="text-blue-500 hover:text-blue-700 p-2 rounded-full hover:bg-blue-50">🔊</button>
                    <button onclick="startPronunciationCheck('${data.word}')" class="text-sm bg-purple-100 text-purple-700 px-3 py-1 rounded-full hover:bg-purple-200 transition">✨ 발음 체크</button>
                </div>
                <p class="text-xl text-gray-600 mb-4">${data.pronunciation}</p>
                <div class="p-4 bg-blue-50 rounded-lg border border-blue-100">
                    <p class="text-2xl font-semibold text-blue-700">${data.koreanMeaning}</p>
                </div>
                <div id="pronunciation-feedback" class="mt-4 hidden p-3 bg-yellow-50 rounded text-sm"></div>
            </div>
        </div>
    </div>`;
    container.insertAdjacentHTML('beforeend', html);
}

function renderEpisode(data, imageUrl, container) {
    const html = `
    <div class="card p-6 mb-6">
        <h3 class="text-xl font-bold mb-4 flex items-center gap-2">💡 기억 돕기 에피소드</h3>
        <div class="flex flex-col md:flex-row gap-6 items-center">
            <div class="flex-1 space-y-2">
                <p class="text-lg italic text-gray-800">"${data.episode.story}"</p>
                <p class="text-gray-600">${data.episode.story_ko}</p>
                <div class="flex gap-2 mt-4">
                    <button class="icon-btn" onclick="speak('${data.episode.story.replace(/'/g, "\\'")}')">🔊 영어로 듣기</button>
                    <button class="btn-3d text-sm py-1" onclick="expandStory(this, '${data.word}', '${data.episode.story.replace(/'/g, "\\'")}', '${data.episode.story_ko.replace(/'/g, "\\'")}')">✍️ 이야기 확장하기</button>
                </div>
            </div>
            <img id="episode-image" src="${imageUrl}" class="w-full md:w-1/4 rounded shadow cursor-pointer hover:opacity-95">
        </div>
    </div>`;
    container.insertAdjacentHTML('beforeend', html);
}

async function renderMeanings(meanings, word, searchId, currentTab, container) {
    const wrapper = document.createElement('div');
    wrapper.className = 'card p-6 space-y-6';
    wrapper.innerHTML = `<h3 class="text-2xl font-bold mb-4">📚 의미 분석</h3>`;
    
    meanings.forEach((m, idx) => {
        const div = document.createElement('div');
        div.className = 'border-t border-gray-200 pt-6 first:border-0 first:pt-0';
        div.innerHTML = `
            <div class="flex items-baseline gap-2 mb-2">
                <span class="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-bold rounded uppercase">${m.type}</span>
            </div>
            <p class="text-lg text-gray-800 mb-3">${m.description}</p>
            <div class="flex flex-col md:flex-row gap-4">
                <div class="flex-1 bg-gray-50 p-4 rounded-lg border border-gray-100">
                    <p class="font-medium text-gray-900 mb-1">${addClickToSearch(m.exampleSentence)}</p>
                    <p class="text-sm text-gray-500">${m.exampleSentenceTranslation}</p>
                    <div class="mt-3 flex gap-2">
                        <button onclick="speak('${m.exampleSentence.replace(/'/g, "\\'")}')" class="text-xs bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-50">🔊 듣기</button>
                        <button onclick="saveSentence('${m.exampleSentence.replace(/'/g, "\\'")}', '${m.exampleSentenceTranslation.replace(/'/g, "\\'")}')" class="text-xs bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-50">💾 저장</button>
                    </div>
                </div>
                <div class="w-full md:w-1/4">
                    <img id="meaning-image-${idx}" src="https://placehold.co/300x200/e0e5ec/4a5568?text=Loading..." class="rounded shadow w-full object-cover h-32 cursor-pointer">
                </div>
            </div>
        `;
        wrapper.appendChild(div);
    });
    container.appendChild(wrapper);
}

function renderSentenceCrafter(word, container) { 
    const html = `
    <div class="card p-6 mt-6 bg-gradient-to-r from-blue-50 to-indigo-50">
        <h3 class="font-bold text-xl mb-2 flex items-center gap-2">✨ AI 문장 만들기</h3>
        <p class="text-sm text-gray-600 mb-3">단어를 사용하고 싶은 상황(예: "비즈니스 미팅", "친구와 수다")을 입력하세요.</p>
        <div class="flex gap-2">
            <input id="sentence-context-input" type="text" placeholder="상황을 입력하세요..." class="border p-3 flex-grow rounded-lg shadow-sm focus:ring-2 focus:ring-blue-300 outline-none">
            <button onclick="craftSentences(this, '${word}')" class="bg-blue-600 text-white px-6 rounded-lg hover:bg-blue-700 transition shadow">생성</button>
        </div>
        <div id="sentence-crafter-results" class="mt-4 space-y-2"></div>
    </div>`;
    container.insertAdjacentHTML('beforeend', html); 
}

function renderDeepDive(data, container) { 
    let html = `<div class="card p-6 mt-6"><h3 class="font-bold text-xl mb-4">🧠 심화 학습</h3>`;
    
    if (data.quotes && data.quotes.length > 0) {
        html += `<div class="mb-4"><h4 class="font-bold text-gray-700 mb-2">명언</h4>
        <div class="space-y-2">
            ${data.quotes.map(q => `<div class="border-l-4 border-gray-300 pl-3"><p class="text-gray-800">"${q.quote}"</p><p class="text-sm text-gray-500">${q.translation}</p></div>`).join('')}
        </div></div>`;
    }
    
    html += `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="bg-green-50 p-3 rounded">
            <h4 class="font-bold text-green-800">유의어</h4>
            <div class="flex flex-wrap gap-2 mt-2">${data.synonyms.map(s => `<span class="bg-white px-2 py-1 rounded text-sm shadow-sm clickable-word cursor-pointer">${s}</span>`).join('')}</div>
        </div>
        <div class="bg-red-50 p-3 rounded">
            <h4 class="font-bold text-red-800">반의어</h4>
            <div class="flex flex-wrap gap-2 mt-2">${data.antonyms.map(a => `<span class="bg-white px-2 py-1 rounded text-sm shadow-sm clickable-word cursor-pointer">${a}</span>`).join('')}</div>
        </div>
    </div>`;
    
    if (data.quiz && data.quiz.length > 0) {
        html += `<div class="mt-6 pt-4 border-t"><h4 class="font-bold text-gray-700 mb-3">퀴즈</h4>${renderQuiz('퀴즈', 'check', data.quiz)}</div>`;
    }
    
    html += `</div>`;
    container.insertAdjacentHTML('beforeend', html);
}

// ... 기타 헬퍼 함수들 (기존 로직 유지 및 최적화) ...

function renderDeepDiveButtonsContainer(c) { const d = document.createElement('div'); d.className = 'flex flex-wrap gap-2 mb-4'; c.appendChild(d); return d; }
function appendConceptTreeButton(c, data) { if(!data) return; const b = document.createElement('button'); b.innerHTML = '🌳 개념 트리 보기'; b.className = 'btn-3d bg-green-100 text-green-700'; b.onclick = () => showConceptTree(data); c.appendChild(b); }
function appendEncyclopediaButton(c, data) { if(!data) return; const b = document.createElement('button'); b.innerHTML = '📖 백과사전 보기'; b.className = 'btn-3d bg-blue-100 text-blue-700'; b.onclick = () => showEncyclopedia(data); c.prepend(b); }

// =========================================================================
// === 7. 유틸리티 및 전역 바인딩 ===
// =========================================================================

// 검색 기록 및 리스트 관리
async function loadSavedPageFromChoice() { const tabId = addTab(searchChoiceWord.textContent); tabs[tabId].fullSearchResult = currentChoicePageData; await renderSavedPage(tabs[tabId], currentChoicePageData); hideSearchChoiceModal(); }
function showSearchChoiceModal(word, data) { searchChoiceWord.textContent = word; currentChoicePageData = data; searchChoiceModal.classList.remove('hidden'); searchChoiceModal.classList.add('flex'); }
function hideSearchChoiceModal() { searchChoiceModal.classList.add('hidden'); }

// 전역 함수 (HTML onclick용)
window.speak = (t, l='en-US') => { const u = new SpeechSynthesisUtterance(t); u.lang=l; window.speechSynthesis.speak(u); };
window.startPronunciationCheck = (w) => showToast(`'${w}' 발음 평가 기능 준비 중입니다.`, "info");
window.craftSentences = async (btn, w) => { 
    const ctx = btn.previousElementSibling.value; 
    if(!ctx) { showToast("상황을 입력해주세요", "warning"); return; }
    btn.disabled = true; btn.innerText = "생성 중...";
    try {
        const res = await callGemini(`Make 3 sentences with "${w}" in context "${ctx}". JSON: [{"en":"...", "ko":"..."}]`, true);
        const html = res.map(s => `<div class="bg-white p-3 rounded shadow-sm"><p class="font-medium">${s.en}</p><p class="text-sm text-gray-500">${s.ko}</p><button onclick="speak('${s.en.replace(/'/g, "\\'")}')" class="text-xs mt-1 text-blue-500">🔊 듣기</button></div>`).join('');
        document.getElementById('sentence-crafter-results').innerHTML = html;
    } catch(e) { showToast("생성 실패", "error"); } finally { btn.disabled = false; btn.innerText = "생성"; }
};
window.showConceptTree = (d) => { modalContent.innerHTML = `<h3 class="text-xl font-bold mb-4">개념 트리</h3><pre class="bg-gray-100 p-4 rounded overflow-auto text-sm">${JSON.stringify(d, null, 2)}</pre><button onclick="hideModal()" class="mt-4 btn-3d">닫기</button>`; modalContainer.classList.remove('hidden'); modalContainer.classList.add('flex'); };
window.showEncyclopedia = (d) => { modalContent.innerHTML = getEncyclopediaHtml(d) + `<button onclick="hideModal()" class="mt-6 btn-3d w-full">닫기</button>`; modalContainer.classList.remove('hidden'); modalContainer.classList.add('flex'); };
window.hideModal = () => { modalContainer.classList.add('hidden'); imageModalContainer.classList.add('hidden'); };
window.showImageModal = (src) => { modalImage.src=src; imageModalContainer.classList.remove('hidden'); imageModalContainer.classList.add('flex'); };
window.showImageAnalysisModal = async (src, w, m) => { 
    showImageModal(src); 
    showToast("이미지를 분석하고 있습니다...", "info");
    try {
        // 이미지 분석 로직 (프록시 또는 직접 호출)
        const analysis = await callGemini(`Analyze this image for "${w}" (${m}). Describe connection.`, false); 
        showToast("분석 완료: " + analysis.substring(0, 50) + "...", "success");
    } catch(e) { console.error(e); }
};
window.handleWordClick = (e) => {
    if (e.target.classList.contains('clickable-word')) {
        const word = e.target.textContent.replace(/[^a-zA-Z]/g, "");
        if(word) { searchInput.value = word; handleSearch(word); }
    }
};
window.handleWordHover = async (e) => {
    if (e.target.classList.contains('clickable-word')) {
        const word = e.target.textContent.replace(/[^a-zA-Z]/g, "");
        if(!word) return;
        if(!translationCache[word]) {
            try { translationCache[word] = await callGemini(`Translate "${word}" to Korean (one word).`); } catch(e) {}
        }
        if(translationCache[word]) {
            wordTooltip.textContent = translationCache[word];
            wordTooltip.classList.remove('hidden');
            const r = e.target.getBoundingClientRect();
            wordTooltip.style.left = (r.left + window.scrollX) + "px";
            wordTooltip.style.top = (r.top + window.scrollY - 30) + "px";
        }
    }
};
window.shareApp = () => { navigator.clipboard.writeText(window.location.href); showToast("주소가 복사되었습니다!", "success"); };
window.showFileModal = () => { fileModalContainer.classList.remove('hidden'); fileModalContainer.classList.add('flex'); };
window.hideFileModal = () => { fileModalContainer.classList.add('hidden'); };
window.loadWordFromList = (w, s) => { searchInput.value = w; s ? checkAndLoadPage(w) : executeSearchForWord(w); hideListModal(); };

// 실행
document.addEventListener('DOMContentLoaded', initializeFirebase);
