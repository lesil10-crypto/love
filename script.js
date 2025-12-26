import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, addDoc, writeBatch, query, setLogLevel, orderBy } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject, uploadBytes } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// === Firebase 설정 ===
const USER_FIREBASE_CONFIG = {
    apiKey: "AIzaSyC-UisM1j624UWaQESMGCtYAuvkimpjBI8",
    authDomain: "projec-48c55.firebaseapp.com",
    projectId: "projec-48c55",
    storageBucket: "projec-48c55.appspot.com",
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
let currentListType = 'words';
let currentSort = 'date-desc';

// =========================================================================
// === 1. 이미지 생성 함수 (Pollinations Flux 모델) ===
// =========================================================================

async function callImagenWithRetry(prompt, retries = 3) {
    try {
        const safePrompt = prompt.length > 400 ? prompt.substring(0, 400) : prompt;
        const encodedPrompt = encodeURIComponent(safePrompt);
        const randomSeed = Math.floor(Math.random() * 100000);
        
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=flux&nologo=true&seed=${randomSeed}`;

        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error(`Image generation failed: ${response.status}`);
        
        const blob = await response.blob();
        
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve({ url: reader.result, status: 'success' });
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
// === 2. Gemini API 호출 ===
// =========================================================================

async function callGemini(prompt, isJson = false, base64Image = null) {
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

        if (isJson) {
            let jsonString = text.trim();
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
        storage = getStorage(app); 
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

    // UI 이벤트 리스너
    confirmOkBtn.addEventListener('click', () => { if (confirmCallback) confirmCallback(); hideConfirmationModal(); });
    confirmCancelBtn.addEventListener('click', hideConfirmationModal);

    // 저장된 페이지 선택 모달 이벤트 연결
    if(searchChoiceLoadSavedBtn) searchChoiceLoadSavedBtn.addEventListener('click', loadSavedPageFromChoice);
    if(searchChoiceNewSearchBtn) searchChoiceNewSearchBtn.addEventListener('click', () => {
        executeSearchForWord(searchChoiceWord.textContent); 
        hideSearchChoiceModal();
    });
    if(searchChoiceCancelBtn) searchChoiceCancelBtn.addEventListener('click', hideSearchChoiceModal);

    fileUploadButton.addEventListener('click', handleFileUpload);

    listModalContent.addEventListener('change', (e) => { if (e.target.classList.contains('item-checkbox')) updateListActionButtonsState(); });

    document.addEventListener('mouseover', handleWordHover);
    document.addEventListener('mouseout', (e) => { if (e.target.classList.contains('clickable-word')) wordTooltip.classList.add('hidden'); });
    document.addEventListener('click', handleWordClick);

    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && userId) handleSearch(searchInput.value.trim()); });
    searchButton.addEventListener('click', () => { if(userId) handleSearch(searchInput.value.trim()); });
    
    document.getElementById('word-list-btn').addEventListener('click', () => showListModal('words'));
    document.getElementById('sentence-list-btn').addEventListener('click', () => showListModal('sentences'));
    document.getElementById('file-storage-btn').addEventListener('click', showFileModal);
    document.getElementById('share-btn').addEventListener('click', shareApp);
    
    sortOptions.addEventListener('change', (e) => { currentSort = e.target.value; renderList(); });
    markReadBtn.addEventListener('click', () => performBulkAction('mark-read'));
    markUnreadBtn.addEventListener('click', () => performBulkAction('mark-unread')); 
    deleteSelectedBtn.addEventListener('click', () => performBulkAction('delete'));
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
            // 저장된 페이지가 있으면 선택 모달 표시
            showSearchChoiceModal(word, docSnap.data().pageData);
        } else {
            // 없으면 바로 검색 실행
            executeSearchForWord(word);
        }
    } catch (error) {
        console.error("Check saved page error:", error);
        executeSearchForWord(word); 
    }
}

// === 누락되었던 모달 관련 함수 구현 ===
function showSearchChoiceModal(word, pageData) {
    if(searchChoiceModal) {
        searchChoiceWord.textContent = word;
        currentChoicePageData = pageData;
        searchChoiceModal.classList.remove('hidden');
        searchChoiceModal.classList.add('flex');
    } else {
        // 모달 요소가 없는 경우 바로 검색 (안전 장치)
        executeSearchForWord(word);
    }
}

function hideSearchChoiceModal() {
    if(searchChoiceModal) {
        searchChoiceModal.classList.add('hidden');
        currentChoicePageData = null;
    }
}

function loadSavedPageFromChoice() {
    if (!currentChoicePageData) return;
    const word = searchChoiceWord.textContent;
    const tabId = addTab(word, true);
    const currentTab = tabs[tabId];
    renderSavedPage(currentTab, { initialData: currentChoicePageData.initialData, ...currentChoicePageData });
    hideSearchChoiceModal();
    showToast("저장된 페이지를 불러왔습니다.", "success");
}
// ======================================

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

        updateLoader(40, "의미 및 예문 생성 중...");
        const meaningsPrompt = `Analyze meanings for "${initialData.word}". JSON array: [{ "type": "...", "description": "...", "exampleSentence": "...", "exampleSentenceTranslation": "...", "imagePrompt": "..." }]`;
        const meaningsData = await callGemini(meaningsPrompt, true);
        currentTab.fullSearchResult.meaningsData = meaningsData;
        
        await renderMeanings(meaningsData, initialData.word, searchId, currentTab, currentTab.contentEl);
        
        renderSentenceCrafter(initialData.word, currentTab.contentEl);
        
        updateLoader(75, "심화 정보 생성 중...");
        const divePrompt = `Deep dive for "${initialData.word}". JSON: {"quotes": [], "synonyms": [], "antonyms": [], "conceptTree": {}, "dialogue": [], "quiz": []}`;
        const diveData = await callGemini(divePrompt, true);
        currentTab.fullSearchResult.fastDeepDiveData = diveData;
        
        updateLoader(90, "마무리 중...");
        const buttonContainer = renderDeepDiveButtonsContainer(currentTab.contentEl);
        if(diveData.conceptTree) appendConceptTreeButton(buttonContainer, diveData.conceptTree);
        renderDeepDive(diveData, currentTab.contentEl);
        
        hideLoader();
        
        const wikiPrompt = `Write encyclopedia info for "${initialData.word}". JSON: {"encyclopedia": { "introduction": "...", "etymology": "...", "history": "...", "usage": "...", "introduction_ko": "...", "etymology_ko": "...", "history_ko": "...", "usage_ko": "..." }}`;
        callGemini(wikiPrompt, true).then(wikiData => {
            if (searchId === currentTab.searchId) {
                currentTab.fullSearchResult.encyclopediaData = wikiData;
                if(wikiData.encyclopedia) appendEncyclopediaButton(buttonContainer, wikiData.encyclopedia);
            }
        });

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
// === 5. 데이터 저장 및 불러오기 (보완됨) ===
// =========================================================================

async function uploadBase64Image(base64, path) {
    try {
        const storageRef = ref(storage, path);
        const response = await fetch(base64);
        const blob = await response.blob();
        await uploadBytes(storageRef, blob);
        return await getDownloadURL(storageRef);
    } catch (e) {
        console.error("Image Upload Error:", e);
        return base64; // 실패시 원본 반환
    }
}

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

        // 이미지 경로 수정: 올바른 아티팩트 경로 사용
        const processImg = async (url, relativePath) => {
            if (url && url.startsWith('data:image')) {
                const fullPath = `artifacts/${appId}/users/${userId}/${relativePath}`;
                return await uploadBase64Image(url, fullPath);
            }
            return url;
        };

        if (pageData.mainImageUrl) imageUploads.push(processImg(pageData.mainImageUrl, `saved_pages/${word}/main.png`).then(u => pageData.mainImageUrl = u));
        if (pageData.episodeImageUrl) imageUploads.push(processImg(pageData.episodeImageUrl, `saved_pages/${word}/episode.png`).then(u => pageData.episodeImageUrl = u));
        
        if (pageData.meaningsData) {
            pageData.meaningsData.forEach((m, i) => {
                if (m.imageUrl) imageUploads.push(processImg(m.imageUrl, `saved_pages/${word}/meaning_${i}.png`).then(u => pageData.meaningsData[i].imageUrl = u));
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
// === 6. 누락된 헬퍼 함수 구현 (ReferenceError 수정) ===
// =========================================================================

function addTab(title, makeActive = true) {
    tabCounter++;
    const tabId = tabCounter;
    
    // 탭 버튼 생성
    const tabBtn = document.createElement('button');
    tabBtn.className = 'px-4 py-2 bg-gray-200 rounded-t-lg text-sm font-medium text-gray-600 hover:bg-gray-300 transition-colors flex items-center gap-2';
    tabBtn.innerHTML = `
        <span class="max-w-[100px] truncate">${title}</span>
        <span class="hover:text-red-500 rounded-full p-0.5 cursor-pointer" onclick="closeTab(event, ${tabId})">×</span>
    `;
    tabBtn.onclick = () => switchTab(tabId);
    document.getElementById('tabs-container').insertBefore(tabBtn, document.getElementById('tabs-container').lastElementChild); // + 버튼 앞

    // 탭 콘텐츠 영역 생성
    const contentEl = document.createElement('div');
    contentEl.id = `tab-content-${tabId}`;
    contentEl.className = 'hidden';
    document.getElementById('tab-contents').appendChild(contentEl);

    tabs[tabId] = { id: tabId, button: tabBtn, contentEl: contentEl, searchId: 0, title: title };

    if (makeActive) switchTab(tabId);
    return tabId;
}

window.switchTab = (tabId) => {
    Object.values(tabs).forEach(t => {
        t.button.classList.remove('bg-white', 'text-blue-600', 'border-t-2', 'border-blue-500');
        t.button.classList.add('bg-gray-200', 'text-gray-600');
        t.contentEl.classList.add('hidden');
    });
    if(tabs[tabId]) {
        tabs[tabId].button.classList.remove('bg-gray-200', 'text-gray-600');
        tabs[tabId].button.classList.add('bg-white', 'text-blue-600', 'border-t-2', 'border-blue-500');
        tabs[tabId].contentEl.classList.remove('hidden');
        activeTabId = tabId;
    }
};

window.closeTab = (e, tabId) => {
    e.stopPropagation();
    if (Object.keys(tabs).length === 1) return; // 최소 1개 유지
    const tab = tabs[tabId];
    tab.button.remove();
    tab.contentEl.remove();
    delete tabs[tabId];
    if (activeTabId === tabId) {
        const remaining = Object.keys(tabs);
        if (remaining.length > 0) switchTab(remaining[remaining.length - 1]);
    }
};

async function loadUserLists() {
    if (!userId) return;
    
    // 저장된 단어
    onSnapshot(query(collection(db, `artifacts/${appId}/users/${userId}/history`), orderBy('timestamp', 'desc')), (snap) => {
        savedWords = [];
        snap.forEach(d => savedWords.push({ id: d.id, ...d.data() }));
    });

    // 저장된 문장
    onSnapshot(query(collection(db, `artifacts/${appId}/users/${userId}/sentences`), orderBy('timestamp', 'desc')), (snap) => {
        savedSentences = [];
        snap.forEach(d => savedSentences.push({ id: d.id, ...d.data() }));
    });
}

async function listenForFiles() {
    if (!userId) return;
    const q = query(collection(db, `artifacts/${appId}/users/${userId}/file_metadata`), orderBy('timestamp', 'desc'));
    onSnapshot(q, (snap) => {
        const files = [];
        snap.forEach(d => files.push({ id: d.id, ...d.data() }));
        renderFileList(files);
    });
}

function renderFileList(files) {
    const list = document.getElementById('file-list-area');
    if (!list) return;
    if (files.length === 0) {
        list.innerHTML = `<p class="text-gray-500 text-center py-4">업로드된 파일이 없습니다.</p>`;
        return;
    }
    list.innerHTML = files.map(f => `
        <div class="flex items-center justify-between p-3 bg-gray-50 rounded border">
            <div class="flex items-center gap-3 overflow-hidden">
                <span class="text-2xl">📄</span>
                <div class="truncate">
                    <p class="font-medium truncate">${f.name}</p>
                    <p class="text-xs text-gray-500">${new Date(f.timestamp?.toDate()).toLocaleDateString()}</p>
                </div>
            </div>
            <button onclick="deleteFile('${f.id}', '${f.name}')" class="text-red-500 hover:text-red-700 p-2">🗑️</button>
        </div>
    `).join('');
}

window.deleteFile = async (docId, fileName) => {
    if(!confirm(`파일 '${fileName}'을 삭제하시겠습니까?`)) return;
    try {
        await deleteObject(ref(storage, `artifacts/${appId}/users/${userId}/files/${fileName}`));
        await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/file_metadata/${docId}`));
        showToast("파일이 삭제되었습니다.", "success");
    } catch(e) {
        console.error("File delete error:", e);
        showToast("삭제 실패", "error");
    }
};

function renderPrintButton(tab) {
    const btnId = `print-btn-${tab.id}`;
    if (document.getElementById(btnId)) return;
    const btn = document.createElement('button');
    btn.id = btnId;
    btn.className = 'btn-3d mb-4';
    btn.innerText = '🖨️ 결과 인쇄하기';
    btn.disabled = true;
    btn.onclick = () => printTabContent(tab.id);
    tab.contentEl.prepend(btn);
}

function renderSavePageButton(tab) {
    const btnId = `save-page-btn-${tab.id}`;
    if (document.getElementById(btnId)) return;
    const btn = document.createElement('button');
    btn.id = btnId;
    btn.className = 'btn-3d mb-4 ml-2';
    btn.innerText = '💾 이 페이지 저장하기';
    btn.disabled = true;
    btn.onclick = () => saveCurrentPage(tab.id);
    tab.contentEl.querySelector(`#print-btn-${tab.id}`).after(btn);
}

function renderDeletePageButton(container, word, replaceId) {
    const btn = document.createElement('button');
    btn.id = `delete-page-btn-${word}`;
    btn.className = 'btn-3d mb-4 ml-4 !bg-red-100 !text-red-600 hover:!bg-red-200';
    btn.innerText = '🗑️ 저장된 페이지 삭제';
    btn.onclick = () => deleteSavedPage(word);
    
    const target = document.getElementById(replaceId);
    if(target) target.replaceWith(btn);
}

async function addWordToHistory(word, meaning) {
    if(!userId) return;
    try {
        const ref = doc(db, `artifacts/${appId}/users/${userId}/history/${word}`);
        await setDoc(ref, {
            word: word,
            meaning: meaning,
            timestamp: new Date(),
            read: false
        });
    } catch(e) { console.error("History add failed", e); }
}

window.saveSentence = async (en, ko) => {
    if(!userId) { showToast("로그인이 필요합니다.", "error"); return; }
    try {
        await addDoc(collection(db, `artifacts/${appId}/users/${userId}/sentences`), {
            en: en, ko: ko, timestamp: new Date(), read: false
        });
        showToast("문장이 저장되었습니다.", "success");
    } catch(e) { showToast("저장 실패", "error"); }
};

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

// 렌더링 헬퍼
function renderDeepDiveButtonsContainer(c) { const d = document.createElement('div'); d.className = 'flex flex-wrap gap-2 mb-4'; c.appendChild(d); return d; }
function appendConceptTreeButton(c, data) { if(!data) return; const b = document.createElement('button'); b.innerHTML = '🌳 개념 트리 보기'; b.className = 'btn-3d bg-green-100 text-green-700'; b.onclick = () => showConceptTree(data); c.appendChild(b); }
function appendEncyclopediaButton(c, data) { if(!data) return; const b = document.createElement('button'); b.innerHTML = '📖 백과사전 보기'; b.className = 'btn-3d bg-blue-100 text-blue-700'; b.onclick = () => showEncyclopedia(data); c.prepend(b); }

function renderQuiz(title, type, quizData) {
    return `<div class="space-y-2">${quizData.map((q, i) => `
        <div class="bg-gray-50 p-3 rounded">
            <p class="font-bold">Q${i+1}. ${q.question}</p>
            <ul class="ml-4 list-disc text-sm mt-1">
                ${q.options.map(o => `<li>${o}</li>`).join('')}
            </ul>
            <details class="mt-2 text-sm text-blue-600 cursor-pointer"><summary>정답 보기</summary><p class="text-gray-700 p-2 bg-white mt-1 border rounded">${q.answer}</p></details>
        </div>
    `).join('')}</div>`;
}

async function renderSavedPage(tab, data) {
    tab.contentEl.innerHTML = '';
    renderDeletePageButton(tab.contentEl, data.initialData.word, null); 
    const delBtn = document.getElementById(`delete-page-btn-${data.initialData.word}`);
    if(delBtn) tab.contentEl.prepend(delBtn);

    renderBasicInfo(data.initialData, data.mainImageUrl || "https://placehold.co/300", tab.contentEl);
    renderEpisode(data.initialData, data.episodeImageUrl || "https://placehold.co/300", tab.contentEl);
    if(data.meaningsData) await renderMeanings(data.meaningsData, data.initialData.word, 0, tab, tab.contentEl);
    renderDeepDive(data.fastDeepDiveData, tab.contentEl);
}

function getEncyclopediaHtml(data) {
    if(!data || !data.encyclopedia) return '<p>정보 없음</p>';
    const e = data.encyclopedia;
    return `
        <h3 class="text-2xl font-bold mb-4">📖 백과사전 정보</h3>
        <div class="space-y-4 overflow-y-auto max-h-[60vh]">
            <div><h4 class="font-bold text-gray-700">개요</h4><p>${e.introduction_ko}</p></div>
            <div><h4 class="font-bold text-gray-700">어원</h4><p>${e.etymology_ko}</p></div>
            <div><h4 class="font-bold text-gray-700">역사</h4><p>${e.history_ko}</p></div>
            <div><h4 class="font-bold text-gray-700">사용법</h4><p>${e.usage_ko}</p></div>
        </div>
    `;
}

// 리스트 모달 관련
window.showListModal = (type) => {
    currentListType = type;
    listModalTitle.innerText = type === 'words' ? '단어장' : '문장 보관함';
    listModalContainer.classList.remove('hidden');
    listModalContainer.classList.add('flex');
    renderList();
};

window.hideListModal = () => listModalContainer.classList.add('hidden');

function renderList() {
    let data = currentListType === 'words' ? [...savedWords] : [...savedSentences];
    
    // 정렬
    if(currentSort === 'date-desc') data.sort((a,b) => b.timestamp - a.timestamp);
    if(currentSort === 'date-asc') data.sort((a,b) => a.timestamp - b.timestamp);
    if(currentSort === 'alpha-asc') data.sort((a,b) => (a.word||a.en).localeCompare(b.word||b.en));

    listModalContent.innerHTML = data.map(item => {
        const title = currentListType === 'words' ? item.word : item.en;
        const sub = currentListType === 'words' ? item.meaning : item.ko;
        const id = item.id;
        return `
            <div class="flex items-center p-3 border-b hover:bg-gray-50">
                <input type="checkbox" class="item-checkbox mr-3 w-4 h-4" data-id="${id}">
                <div class="flex-grow cursor-pointer" onclick="loadWordFromList('${title}', ${currentListType === 'words'})">
                    <p class="font-bold text-gray-800">${title}</p>
                    <p class="text-sm text-gray-500">${sub}</p>
                </div>
                <span class="text-xs text-gray-400">${item.read ? '읽음' : '안읽음'}</span>
            </div>
        `;
    }).join('');
    updateListActionButtonsState();
}

function updateListActionButtonsState() {
    const checked = listModalContent.querySelectorAll('.item-checkbox:checked');
    const hasChecked = checked.length > 0;
    markReadBtn.disabled = !hasChecked;
    markUnreadBtn.disabled = !hasChecked;
    deleteSelectedBtn.disabled = !hasChecked;
}

async function performBulkAction(action) {
    if(!userId) return;
    const checked = Array.from(listModalContent.querySelectorAll('.item-checkbox:checked')).map(c => c.dataset.id);
    if(checked.length === 0) return;

    const collectionName = currentListType === 'words' ? 'history' : 'sentences';
    const batch = writeBatch(db);

    checked.forEach(id => {
        const ref = doc(db, `artifacts/${appId}/users/${userId}/${collectionName}/${id}`);
        if(action === 'delete') batch.delete(ref);
        else batch.update(ref, { read: action === 'mark-read' });
    });

    try {
        await batch.commit();
        showToast("처리되었습니다.", "success");
    } catch(e) { showToast("처리 실패", "error"); }
}

// 파일 업로드 처리
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

// UI 유틸리티
function showToast(msg, type='info') {
    const t = document.createElement('div');
    t.className = `fixed bottom-4 right-4 px-6 py-3 rounded shadow-lg text-white transform transition-all duration-300 translate-y-10 z-50 ${type==='error'?'bg-red-500':type==='success'?'bg-green-500':'bg-gray-800'}`;
    t.innerText = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.remove('translate-y-10'));
    setTimeout(() => { t.classList.add('opacity-0', 'translate-y-10'); setTimeout(()=>t.remove(), 300); }, 3000);
}

function showLoader(progress, text) {
    loadingContainer.classList.remove('hidden');
    updateLoader(progress, text);
}
function updateLoader(progress, text) {
    progressBar.style.width = `${progress}%`;
    loadingText.innerText = text;
}
function hideLoader() {
    loadingContainer.classList.add('hidden');
    progressBar.style.width = '0%';
}
function showConfirmationModal(msg, cb) {
    confirmationMessage.innerText = msg;
    confirmCallback = cb;
    confirmationModal.classList.remove('hidden');
    confirmationModal.classList.add('flex');
}
function hideConfirmationModal() {
    confirmationModal.classList.add('hidden');
    confirmCallback = null;
}
function addClickToSearch(text) {
    return text.split(' ').map(w => `<span class="clickable-word cursor-pointer hover:bg-yellow-200 rounded px-0.5 transition">${w}</span>`).join(' ');
}
function safeCreateIcons() {
    if(window.lucide) window.lucide.createIcons();
}
function printTabContent(tabId) {
    const tab = tabs[tabId];
    if(!tab) return;
    printContentArea.innerHTML = tab.contentEl.innerHTML;
    // 프린트 시 버튼들 제거
    printContentArea.querySelectorAll('button').forEach(b => b.remove());
    printContainer.classList.remove('hidden');
    window.print();
    printContainer.classList.add('hidden');
}

// 전역 함수 바인딩
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
