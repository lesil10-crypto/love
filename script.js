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

// === 전역 변수 선언 ===
// DOM 요소
let searchInput, searchButton, loadingContainer, loadingText, progressBar, searchBarContainer;
let printContainer, printContentArea, modalContainer, modalContent, imageModalContainer, modalImage;
let wordTooltip, fileModalContainer, fileUploadInput, fileUploadButton;
let listModalContainer, listModalTitle, listModalContent, sortOptions;
let markReadBtn, markUnreadBtn, deleteSelectedBtn;
let confirmationModal, confirmationMessage, confirmOkBtn, confirmCancelBtn;
let searchChoiceModal, searchChoiceWord, searchChoiceLoadSavedBtn, searchChoiceNewSearchBtn, searchChoiceCancelBtn;
let confirmCallback = null;
let currentChoicePageData = null;

// API 및 데이터
const textApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent`;
const translationCache = {};
let db, auth, storage, userId, app;
const appId = 'default-ai-vocab-app';

// 앱 상태
let tabs = {};
let activeTabId = null;
let tabCounter = 0;
let savedWords = [];
let savedSentences = [];
let currentListType = 'words';
let currentSort = 'date-desc';

// =========================================================================
// === [중요] 로그인 함수 추가 (ReferenceError 해결) ===
// =========================================================================

window.signInWithGoogle = async () => {
    if (!auth) {
        showToast("시스템 로딩 중입니다. 잠시 후 다시 시도해주세요.", "warning");
        return;
    }
    try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
        // 로그인 성공 시 onAuthStateChanged에서 UI 자동 업데이트됨
    } catch (error) {
        console.error("Google Sign-In Error:", error);
        showToast("로그인에 실패했습니다: " + error.message, "error");
    }
};

// =========================================================================
// === 1. 이미지 생성 (Pollinations) ===
// =========================================================================

async function callImagenWithRetry(prompt) {
    try {
        const safePrompt = prompt.length > 400 ? prompt.substring(0, 400) : prompt;
        const encodedPrompt = encodeURIComponent(safePrompt);
        const randomSeed = Math.floor(Math.random() * 100000);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=flux&nologo=true&seed=${randomSeed}`;
        
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error(`Image Gen Failed: ${response.status}`);
        
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve({ url: reader.result, status: 'success' });
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.error("Image generation error:", e);
        return { 
            url: `https://placehold.co/1024x1024/e0e5ec/4a5568?text=Image+Error`, 
            status: 'failed' 
        };
    }
}

// =========================================================================
// === 2. Gemini API 호출 ===
// =========================================================================

async function callGemini(prompt, isJson = false, base64Image = null) {
    const url = `${textApiUrl}?key=${USER_FIREBASE_CONFIG.apiKey}`;
    const parts = [{ text: prompt }];
    
    if (base64Image) {
        parts.push({ inlineData: { mimeType: "image/png", data: base64Image } });
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
            throw new Error(`Gemini Error: ${response.status}`);
        }

        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!text) throw new Error("Empty response from Gemini");

        if (isJson) {
            let jsonString = text.trim();
            if (jsonString.startsWith("```json")) jsonString = jsonString.slice(7, -3).trim();
            else if (jsonString.startsWith("```")) jsonString = jsonString.slice(3, -3).trim();
            return JSON.parse(jsonString);
        }
        return text;

    } catch (error) {
        console.error("Gemini API Fail:", error);
        throw error;
    }
}

// =========================================================================
// === 3. 초기화 및 Firebase ===
// =========================================================================

async function initializeFirebase() {
    // DOM 요소 가져오기 (오류 방지를 위해 개별 변수 할당)
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
    
    // 모달 요소 안전 확인
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
            const authStatus = document.getElementById('auth-status');
            const appContainer = document.getElementById('app-container');
            const authContainer = document.getElementById('auth-container');

            if (user) {
                userId = user.uid;
                if (authStatus) {
                    authStatus.innerHTML = `<span class="text-sm">환영합니다 ${user.displayName || '사용자'}님</span><button id="google-logout-btn" class="btn-3d !p-2 !text-xs !bg-red-400 !text-white hover:!bg-red-500">로그아웃</button>`;
                    document.getElementById('google-logout-btn').onclick = () => signOut(auth);
                }
                
                if (appContainer) appContainer.style.visibility = 'visible';
                if (authContainer) authContainer.classList.add('hidden');
                
                if (searchInput) {
                    searchInput.disabled = false;
                    searchInput.placeholder = "단어를 입력하세요...";
                }

                loadUserLists();
                listenForFiles();

            } else {
                userId = null;
                if (authStatus) authStatus.innerHTML = `<span class="text-sm">로그인이 필요합니다.</span>`;
                
                if (appContainer) appContainer.style.visibility = 'hidden';
                if (authContainer) authContainer.classList.remove('hidden');

                if (searchInput) searchInput.disabled = true;

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

    // 이벤트 리스너 연결
    if (confirmOkBtn) confirmOkBtn.addEventListener('click', () => { if (confirmCallback) confirmCallback(); hideConfirmationModal(); });
    if (confirmCancelBtn) confirmCancelBtn.addEventListener('click', hideConfirmationModal);
    
    if (searchChoiceLoadSavedBtn) searchChoiceLoadSavedBtn.addEventListener('click', loadSavedPageFromChoice);
    if (searchChoiceNewSearchBtn) searchChoiceNewSearchBtn.addEventListener('click', () => { executeSearchForWord(searchChoiceWord.textContent); hideSearchChoiceModal(); });
    if (searchChoiceCancelBtn) searchChoiceCancelBtn.addEventListener('click', hideSearchChoiceModal);

    if (fileUploadButton) fileUploadButton.addEventListener('click', handleFileUpload);
    if (listModalContent) listModalContent.addEventListener('change', (e) => { if (e.target.classList.contains('item-checkbox')) updateListActionButtonsState(); });

    document.addEventListener('mouseover', handleWordHover);
    document.addEventListener('mouseout', (e) => { if (e.target.classList.contains('clickable-word')) wordTooltip.classList.add('hidden'); });
    document.addEventListener('click', handleWordClick);

    if (searchInput) searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && userId) handleSearch(searchInput.value.trim()); });
    if (searchButton) searchButton.addEventListener('click', () => { if(userId && searchInput) handleSearch(searchInput.value.trim()); });
    
    const wordListBtn = document.getElementById('word-list-btn');
    if (wordListBtn) wordListBtn.addEventListener('click', () => showListModal('words'));
    
    const sentenceListBtn = document.getElementById('sentence-list-btn');
    if (sentenceListBtn) sentenceListBtn.addEventListener('click', () => showListModal('sentences'));
    
    const fileStorageBtn = document.getElementById('file-storage-btn');
    if (fileStorageBtn) fileStorageBtn.addEventListener('click', showFileModal);
    
    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) shareBtn.addEventListener('click', shareApp);
    
    if (sortOptions) sortOptions.addEventListener('change', (e) => { currentSort = e.target.value; renderList(); });
    if (markReadBtn) markReadBtn.addEventListener('click', () => performBulkAction('mark-read'));
    if (markUnreadBtn) markUnreadBtn.addEventListener('click', () => performBulkAction('mark-unread')); 
    if (deleteSelectedBtn) deleteSelectedBtn.addEventListener('click', () => performBulkAction('delete'));
} 

// =========================================================================
// === 4. 검색 및 로직 ===
// =========================================================================

async function handleSearch(query) {
    if (!userId) return showToast("로그인이 필요합니다.", "error");
    if (!query) return showToast("검색어를 입력해주세요.", "warning");
    
    // 한글 체크
    if (/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(query)) {
        showLoader(0, `'${query}' 번역 및 확인 중...`);
        try {
            const prompt = `Translate Korean "${query}" to English. Return JSON: {"is_ambiguous": boolean, "english_words": ["word1", "word2"]}`;
            const data = await callGemini(prompt, true);
            const words = [...new Set(data.english_words.map(w => w.toLowerCase().trim()))];
            
            if (data.is_ambiguous && words.length > 1) {
                showToast(`${words.length}개의 관련 단어를 찾았습니다.`, "info");
                for (const word of words) {
                    await checkAndLoadPage(word);
                }
            } else {
                await checkAndLoadPage(words[0] || query);
            }
        } catch (e) {
            console.error(e);
            await checkAndLoadPage(query);
        } finally {
            hideLoader();
        }
    } else {
        await checkAndLoadPage(query);
    }
}

async function checkAndLoadPage(word) {
    if (!db || !userId) {
        return executeSearchForWord(word);
    }
    const normalizedWord = word.toLowerCase();
    try {
        const docRef = doc(db, `artifacts/${appId}/users/${userId}/saved_pages/${normalizedWord}`);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            showSearchChoiceModal(word, docSnap.data().pageData);
        } else {
            executeSearchForWord(word);
        }
    } catch (error) {
        console.error("Error checking page:", error);
        executeSearchForWord(word);
    }
}

function showSearchChoiceModal(word, pageData) {
    if (searchChoiceModal) {
        searchChoiceWord.textContent = word;
        currentChoicePageData = pageData;
        searchChoiceModal.classList.remove('hidden');
        searchChoiceModal.classList.add('flex');
    } else {
        executeSearchForWord(word);
    }
}

function hideSearchChoiceModal() {
    if (searchChoiceModal) {
        searchChoiceModal.classList.add('hidden');
        currentChoicePageData = null;
    }
}

function loadSavedPageFromChoice() {
    if (!currentChoicePageData) return;
    const word = searchChoiceWord.textContent;
    const tabId = addTab(word, true);
    renderSavedPage(tabs[tabId], { initialData: currentChoicePageData.initialData, ...currentChoicePageData });
    hideSearchChoiceModal();
    showToast("저장된 페이지를 불러왔습니다.", "success");
}

async function executeSearchForWord(wordQuery, makeActive = true) {
    const tabId = addTab(wordQuery, makeActive);
    const currentTab = tabs[tabId];
    currentTab.contentEl.innerHTML = '';
    const searchId = ++currentTab.searchId;
    currentTab.fullSearchResult = {};
    currentTab.imageLoadPromises = []; 
    
    showLoader(0, `"${wordQuery}" 분석 시작...`);
    if (searchButton) searchButton.disabled = true;

    try {
        updateLoader(10, "기본 정보 생성 중...");
        const initialPrompt = `Create info for English word "${wordQuery}" in JSON: {"word":"", "koreanMeaning":"", "pronunciation":"", "mainImagePrompt":"", "episode":{"story":"", "story_ko":"", "imagePrompt":""}}`;
        const initialData = await callGemini(initialPrompt, true);
        
        initialData.word = initialData.word.toLowerCase();
        currentTab.fullSearchResult.initialData = initialData;
        
        if (searchId !== currentTab.searchId) return;
        
        updateLoader(25, "화면 구성 중...");
        renderPrintButton(currentTab);
        renderSavePageButton(currentTab); 
        
        const placeholder = "https://placehold.co/300x300/e0e5ec/4a5568?text=Loading";
        renderBasicInfo(initialData, placeholder, currentTab.contentEl);
        renderEpisode(initialData, placeholder, currentTab.contentEl);
        addWordToHistory(initialData.word, initialData.koreanMeaning);
        
        // 이미지 생성 (비동기)
        const mainImgPromise = callImagenWithRetry(initialData.mainImagePrompt).then(res => {
            currentTab.fullSearchResult.mainImageUrl = res.url;
            const img = currentTab.contentEl.querySelector('#main-image');
            if (img) {
                img.src = res.url;
                img.onclick = () => showImageAnalysisModal(res.url, initialData.word, initialData.koreanMeaning);
            }
        });
        currentTab.imageLoadPromises.push(mainImgPromise);
        
        const epImgPromise = callImagenWithRetry(initialData.episode.imagePrompt).then(res => {
            currentTab.fullSearchResult.episodeImageUrl = res.url;
            const img = currentTab.contentEl.querySelector('#episode-image');
            if (img) {
                img.src = res.url;
                img.onclick = () => showImageModal(res.url);
            }
        });
        currentTab.imageLoadPromises.push(epImgPromise);

        updateLoader(50, "의미 및 예문 생성 중...");
        const meaningsPrompt = `Analyze meanings for "${initialData.word}". JSON array: [{ "type": "...", "description": "...", "exampleSentence": "...", "exampleSentenceTranslation": "...", "imagePrompt": "..." }]`;
        const meaningsData = await callGemini(meaningsPrompt, true);
        
        currentTab.fullSearchResult.meaningsData = meaningsData;
        await renderMeanings(meaningsData, initialData.word, searchId, currentTab, currentTab.contentEl);
        
        renderSentenceCrafter(initialData.word, currentTab.contentEl);
        
        updateLoader(80, "심화 정보 생성 중...");
        const divePrompt = `Deep dive for "${initialData.word}". JSON: {"quotes": [], "synonyms": [], "antonyms": [], "conceptTree": {}, "dialogue": [], "quiz": []}`;
        const diveData = await callGemini(divePrompt, true);
        currentTab.fullSearchResult.fastDeepDiveData = diveData;
        
        const btnContainer = renderDeepDiveButtonsContainer(currentTab.contentEl);
        if (diveData.conceptTree) appendConceptTreeButton(btnContainer, diveData.conceptTree);
        renderDeepDive(diveData, currentTab.contentEl);
        
        hideLoader();
        
        // 백과사전 (백그라운드)
        callGemini(`Write encyclopedia info for "${initialData.word}". JSON: {"encyclopedia": { "introduction_ko": "...", "etymology_ko": "...", "history_ko": "...", "usage_ko": "..." }}`, true).then(wikiData => {
            if (searchId === currentTab.searchId) {
                currentTab.fullSearchResult.encyclopediaData = wikiData;
                if (wikiData.encyclopedia) appendEncyclopediaButton(btnContainer, wikiData.encyclopedia);
            }
        });

        // 이미지 로딩 완료 후 저장/인쇄 버튼 활성화
        Promise.all(currentTab.imageLoadPromises).then(() => {
            if (searchId === currentTab.searchId) {
                const saveBtn = document.getElementById(`save-page-btn-${currentTab.id}`);
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = `💾 이 페이지 저장하기`;
                }
                const printBtn = document.getElementById(`print-btn-${currentTab.id}`);
                if (printBtn) {
                    printBtn.disabled = false;
                }
            }
        });

    } catch (error) {
        console.error("Search Error:", error);
        showToast("오류가 발생했습니다. 다시 시도해주세요.", "error");
        hideLoader();
    } finally {
        if (searchButton) searchButton.disabled = false;
    }
}

// =========================================================================
// === 5. 저장 및 삭제 ===
// =========================================================================

async function uploadBase64Image(base64, path) {
    try {
        const storageRef = ref(storage, path);
        const response = await fetch(base64);
        const blob = await response.blob();
        await uploadBytes(storageRef, blob);
        return await getDownloadURL(storageRef);
    } catch (e) {
        console.error("Upload Error:", e);
        return base64; // 실패 시 원본 반환
    }
}

window.saveCurrentPage = async function(tabId) {
    const tab = tabs[tabId];
    if (!tab || !tab.fullSearchResult || !userId) {
        return showToast(userId ? "저장 중입니다..." : "로그인이 필요합니다.", userId ? "info" : "error");
    }
    
    const btn = document.getElementById(`save-page-btn-${tabId}`);
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `저장 중...`;
    }

    try {
        const word = tab.fullSearchResult.initialData.word.toLowerCase();
        const pageData = JSON.parse(JSON.stringify(tab.fullSearchResult)); 
        const uploads = [];

        const processImg = async (url, subPath) => {
            if (url && url.startsWith('data:image')) {
                return await uploadBase64Image(url, `artifacts/${appId}/users/${userId}/${subPath}`);
            }
            return url;
        };

        if (pageData.mainImageUrl) {
            uploads.push(processImg(pageData.mainImageUrl, `saved_pages/${word}/main.png`).then(u => pageData.mainImageUrl = u));
        }
        if (pageData.episodeImageUrl) {
            uploads.push(processImg(pageData.episodeImageUrl, `saved_pages/${word}/episode.png`).then(u => pageData.episodeImageUrl = u));
        }
        if (pageData.meaningsData) {
            pageData.meaningsData.forEach((m, i) => {
                if (m.imageUrl) {
                    uploads.push(processImg(m.imageUrl, `saved_pages/${word}/meaning_${i}.png`).then(u => pageData.meaningsData[i].imageUrl = u));
                }
            });
        }

        await Promise.all(uploads);

        await setDoc(doc(db, `artifacts/${appId}/users/${userId}/saved_pages/${word}`), {
            word: word,
            savedAt: new Date(),
            pageData: pageData
        });

        showToast("저장이 완료되었습니다.", "success");
        renderDeletePageButton(tab.contentEl, word, `save-page-btn-${tabId}`);

    } catch (e) {
        console.error("Save Error:", e);
        showToast("저장에 실패했습니다.", "error");
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `💾 이 페이지 저장하기`;
        }
    }
}

window.deleteSavedPage = async function(word) {
    const nWord = word.toLowerCase();
    showConfirmationModal(`'${nWord}' 페이지를 삭제하시겠습니까?`, async () => {
        try {
            await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/saved_pages/${nWord}`));
            showToast("삭제되었습니다.", "success");
            
            const delBtn = document.getElementById(`delete-page-btn-${nWord}`);
            if (delBtn) {
                const tabId = delBtn.closest('[id^="tab-content-"]').id.replace('tab-content-', 'tab-');
                const saveBtn = document.createElement('button');
                saveBtn.id = `save-page-btn-${tabId}`;
                saveBtn.className = 'btn-3d mb-4 ml-4';
                saveBtn.innerHTML = `💾 이 페이지 저장하기`;
                saveBtn.onclick = () => saveCurrentPage(tabId);
                delBtn.replaceWith(saveBtn);
            }
        } catch (e) {
            showToast("삭제 실패", "error");
        }
    });
}

// =========================================================================
// === 6. 헬퍼 함수 ===
// =========================================================================

function addTab(title, makeActive = true) {
    tabCounter++;
    const id = tabCounter;
    
    const btn = document.createElement('button');
    btn.className = 'px-4 py-2 bg-gray-200 rounded-t-lg text-sm font-medium text-gray-600 hover:bg-gray-300 transition-colors flex items-center gap-2';
    btn.innerHTML = `<span class="truncate max-w-[100px]">${title}</span><span class="hover:text-red-500 rounded-full p-0.5 cursor-pointer" onclick="closeTab(event, ${id})">×</span>`;
    btn.onclick = () => switchTab(id);
    
    const container = document.getElementById('tabs-container');
    if (container) container.insertBefore(btn, container.lastElementChild);
    
    const content = document.createElement('div');
    content.id = `tab-content-${id}`;
    content.className = 'hidden';
    
    const contentsContainer = document.getElementById('tab-contents');
    if (contentsContainer) contentsContainer.appendChild(content);

    tabs[id] = { id: id, button: btn, contentEl: content, searchId: 0, title: title };
    
    if (makeActive) switchTab(id);
    return id;
}

window.switchTab = (id) => {
    Object.values(tabs).forEach(t => {
        t.button.className = t.button.className.replace('bg-white text-blue-600 border-t-2 border-blue-500', 'bg-gray-200 text-gray-600');
        t.contentEl.classList.add('hidden');
    });
    if (tabs[id]) {
        tabs[id].button.className = tabs[id].button.className.replace('bg-gray-200 text-gray-600', 'bg-white text-blue-600 border-t-2 border-blue-500');
        tabs[id].contentEl.classList.remove('hidden');
        activeTabId = id;
    }
};

window.closeTab = (e, id) => {
    e.stopPropagation();
    if (Object.keys(tabs).length === 1) return;
    
    if (tabs[id]) {
        tabs[id].button.remove();
        tabs[id].contentEl.remove();
        delete tabs[id];
        
        if (activeTabId === id) {
            const keys = Object.keys(tabs);
            if (keys.length > 0) switchTab(keys[keys.length - 1]);
        }
    }
};

async function loadUserLists() {
    if (!userId) return;
    onSnapshot(query(collection(db, `artifacts/${appId}/users/${userId}/history`), orderBy('timestamp', 'desc')), s => {
        savedWords = [];
        s.forEach(d => savedWords.push({id: d.id, ...d.data()}));
    });
    onSnapshot(query(collection(db, `artifacts/${appId}/users/${userId}/sentences`), orderBy('timestamp', 'desc')), s => {
        savedSentences = [];
        s.forEach(d => savedSentences.push({id: d.id, ...d.data()}));
    });
}

async function listenForFiles() {
    if (!userId) return;
    onSnapshot(query(collection(db, `artifacts/${appId}/users/${userId}/file_metadata`), orderBy('timestamp', 'desc')), s => {
        const files = [];
        s.forEach(d => files.push({id: d.id, ...d.data()}));
        renderFileList(files);
    });
}

function renderFileList(files) {
    const listArea = document.getElementById('file-list-area');
    if (!listArea) return;
    
    if (files.length === 0) {
        listArea.innerHTML = `<p class="text-center text-gray-500 py-4">업로드된 파일이 없습니다.</p>`;
    } else {
        listArea.innerHTML = files.map(f => `
            <div class="flex justify-between items-center p-3 bg-gray-50 rounded border mb-2">
                <div class="truncate flex items-center gap-2">
                    <span>📄</span>
                    <p class="font-medium truncate">${f.name}</p>
                </div>
                <button onclick="deleteFile('${f.id}', '${f.name}')" class="text-red-500 hover:text-red-700 p-2">🗑️</button>
            </div>
        `).join('');
    }
}

window.deleteFile = async (docId, name) => {
    if (!confirm(`'${name}' 파일을 삭제하시겠습니까?`)) return;
    try {
        await deleteObject(ref(storage, `artifacts/${appId}/users/${userId}/files/${name}`));
        await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/file_metadata/${docId}`));
        showToast("삭제되었습니다.", "success");
    } catch (e) {
        showToast("삭제 실패", "error");
    }
};

function renderPrintButton(tab) {
    if (document.getElementById(`print-btn-${tab.id}`)) return;
    const btn = document.createElement('button');
    btn.id = `print-btn-${tab.id}`;
    btn.className = 'btn-3d mb-4';
    btn.innerText = '🖨️ 결과 인쇄하기';
    btn.disabled = true;
    btn.onclick = () => {
        if (printContentArea) {
            printContentArea.innerHTML = tab.contentEl.innerHTML;
            printContentArea.querySelectorAll('button').forEach(b => b.remove());
            if (printContainer) {
                printContainer.classList.remove('hidden');
                window.print();
                printContainer.classList.add('hidden');
            }
        }
    };
    tab.contentEl.prepend(btn);
}

function renderSavePageButton(tab) {
    if (document.getElementById(`save-page-btn-${tab.id}`)) return;
    const btn = document.createElement('button');
    btn.id = `save-page-btn-${tab.id}`;
    btn.className = 'btn-3d mb-4 ml-2';
    btn.innerText = '💾 이 페이지 저장하기';
    btn.disabled = true;
    btn.onclick = () => saveCurrentPage(tab.id);
    const printBtn = tab.contentEl.querySelector(`#print-btn-${tab.id}`);
    if (printBtn) printBtn.after(btn);
}

function renderDeletePageButton(c, w, rid) {
    const btn = document.createElement('button');
    btn.id = `delete-page-btn-${w}`;
    btn.className = 'btn-3d mb-4 ml-4 !bg-red-100 !text-red-600 hover:!bg-red-200';
    btn.innerText = '🗑️ 저장된 페이지 삭제';
    btn.onclick = () => deleteSavedPage(w);
    
    const target = document.getElementById(rid);
    if (target) target.replaceWith(btn);
}

async function addWordToHistory(word, meaning) {
    if (userId) {
        await setDoc(doc(db, `artifacts/${appId}/users/${userId}/history/${word}`), {
            word, meaning, timestamp: new Date(), read: false
        });
    }
}

window.saveSentence = async (en, ko) => {
    if (userId) {
        await addDoc(collection(db, `artifacts/${appId}/users/${userId}/sentences`), {
            en, ko, timestamp: new Date(), read: false
        });
        showToast("문장이 저장되었습니다.", "success");
    } else {
        showToast("로그인이 필요합니다.", "error");
    }
};

function renderBasicInfo(d, img, c) {
    c.insertAdjacentHTML('beforeend', `
        <div class="card p-6 mb-6 flex flex-col md:flex-row gap-6">
            <div class="w-full md:w-1/3">
                <img id="main-image" src="${img}" class="rounded-lg shadow-lg w-full object-cover cursor-pointer hover:opacity-95 transition">
            </div>
            <div class="w-full md:w-2/3">
                <h2 class="text-4xl font-bold text-gray-800 flex items-center gap-2">
                    ${d.word} 
                    <button onclick="speak('${d.word}')" class="text-blue-500 hover:bg-blue-50 rounded-full p-2 text-2xl">🔊</button>
                </h2>
                <p class="text-xl text-gray-600 mt-2">${d.pronunciation}</p>
                <div class="p-4 bg-blue-50 mt-4 rounded-lg border border-blue-100">
                    <p class="text-2xl font-bold text-blue-700">${d.koreanMeaning}</p>
                </div>
            </div>
        </div>
    `);
}

function renderEpisode(d, img, c) {
    c.insertAdjacentHTML('beforeend', `
        <div class="card p-6 mb-6">
            <h3 class="text-xl font-bold mb-4 flex items-center gap-2">💡 기억 돕기 에피소드</h3>
            <div class="flex flex-col md:flex-row gap-6">
                <div class="flex-1 space-y-3">
                    <p class="italic text-lg text-gray-800 border-l-4 border-yellow-400 pl-4 py-1 bg-yellow-50">"${d.episode.story}"</p>
                    <p class="text-gray-600">${d.episode.story_ko}</p>
                    <button class="mt-2 text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1" onclick="speak('${d.episode.story.replace(/'/g, "\\'")}')">
                        🔊 에피소드 듣기
                    </button>
                </div>
                <img id="episode-image" src="${img}" class="w-full md:w-1/4 rounded-lg shadow-md cursor-pointer hover:opacity-95">
            </div>
        </div>
    `);
}

async function renderMeanings(mData, w, sid, tab, c) {
    const div = document.createElement('div');
    div.className = 'card p-6 space-y-6';
    div.innerHTML = `<h3 class="text-2xl font-bold mb-2">📚 의미 분석</h3>`;
    
    mData.forEach(m => {
        div.innerHTML += `
            <div class="border-t border-gray-200 pt-6 mt-2">
                <span class="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded font-bold uppercase">${m.type}</span>
                <p class="text-lg mt-2 text-gray-800 font-medium">${m.description}</p>
                <div class="bg-gray-50 p-4 mt-3 rounded-lg border border-gray-100">
                    <p class="text-gray-900 mb-1 font-medium">${addClickToSearch(m.exampleSentence)}</p>
                    <p class="text-sm text-gray-500">${m.exampleSentenceTranslation}</p>
                    <div class="mt-3 flex gap-2">
                        <button onclick="speak('${m.exampleSentence.replace(/'/g, "\\'")}')" class="text-xs bg-white border px-2 py-1 rounded hover:bg-gray-100">🔊 듣기</button>
                        <button onclick="saveSentence('${m.exampleSentence.replace(/'/g, "\\'")}', '${m.exampleSentenceTranslation.replace(/'/g, "\\'")}')" class="text-xs bg-white border px-2 py-1 rounded hover:bg-gray-100">💾 저장</button>
                    </div>
                </div>
            </div>
        `;
    });
    c.appendChild(div);
}

function renderSentenceCrafter(w, c) { 
    c.insertAdjacentHTML('beforeend', `
        <div class="card p-6 mt-6 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100">
            <h3 class="font-bold text-xl mb-2 flex items-center gap-2">✨ AI 문장 만들기</h3>
            <p class="text-sm text-gray-600 mb-3">이 단어를 사용하고 싶은 상황을 입력해보세요.</p>
            <div class="flex gap-2">
                <input type="text" placeholder="예: 비즈니스 미팅, 친구와 대화..." class="border p-3 rounded-lg w-full focus:ring-2 focus:ring-blue-300 outline-none">
                <button onclick="craftSentences(this, '${w}')" class="bg-blue-600 text-white px-6 rounded-lg hover:bg-blue-700 shadow-sm whitespace-nowrap">생성</button>
            </div>
            <div id="sentence-crafter-results" class="mt-4 space-y-2"></div>
        </div>
    `); 
}

function renderDeepDive(d, c) { 
    let h = `<div class="card p-6 mt-6"><h3 class="font-bold text-xl mb-4">🧠 심화 학습</h3>`;
    
    if (d.quotes && d.quotes.length > 0) {
        h += `<div class="mb-6"><h4 class="font-bold text-gray-700 mb-2">💡 관련 명언</h4><div class="space-y-3">
            ${d.quotes.map(q => `<div class="bg-gray-50 p-3 rounded border-l-4 border-gray-400"><p class="font-serif">"${q.quote}"</p><p class="text-gray-500 text-sm mt-1">- ${q.translation}</p></div>`).join('')}
        </div></div>`;
    }
    
    h += `<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div class="bg-green-50 p-4 rounded-lg">
            <h4 class="font-bold text-green-800 mb-2">유의어 (Synonyms)</h4>
            <div class="flex flex-wrap gap-2">${d.synonyms.map(s => `<span class="clickable-word bg-white px-2 py-1 rounded shadow-sm cursor-pointer hover:bg-green-100 transition">${s}</span>`).join('')}</div>
        </div>
        <div class="bg-red-50 p-4 rounded-lg">
            <h4 class="font-bold text-red-800 mb-2">반의어 (Antonyms)</h4>
            <div class="flex flex-wrap gap-2">${d.antonyms.map(a => `<span class="clickable-word bg-white px-2 py-1 rounded shadow-sm cursor-pointer hover:bg-red-100 transition">${a}</span>`).join('')}</div>
        </div>
    </div>`;
    
    if (d.quiz && d.quiz.length > 0) {
        h += `<div class="mt-6 border-t pt-4"><h4 class="font-bold text-gray-700 mb-3">✍️ 퀴즈</h4>
            <div class="space-y-3">${d.quiz.map((q, i) => `
                <div class="bg-gray-50 p-3 rounded">
                    <p class="font-medium">Q${i+1}. ${q.question}</p>
                    <details class="mt-2 text-sm text-blue-600 cursor-pointer">
                        <summary>정답 보기</summary>
                        <p class="text-gray-800 bg-white p-2 mt-1 rounded border">${q.answer}</p>
                    </details>
                </div>`).join('')}
            </div></div>`;
    }
    
    c.insertAdjacentHTML('beforeend', h + `</div>`);
}

function renderDeepDiveButtonsContainer(c) { 
    const d = document.createElement('div'); 
    d.className = 'flex flex-wrap gap-2 mb-4'; 
    c.appendChild(d); 
    return d; 
}

function appendConceptTreeButton(c, d) { 
    const b = document.createElement('button'); 
    b.innerHTML = '🌳 개념 트리'; 
    b.className = 'btn-3d bg-green-100 text-green-800 hover:bg-green-200'; 
    b.onclick = () => showConceptTree(d); 
    c.appendChild(b); 
}

function appendEncyclopediaButton(c, d) { 
    const b = document.createElement('button'); 
    b.innerHTML = '📖 백과사전'; 
    b.className = 'btn-3d bg-blue-100 text-blue-800 hover:bg-blue-200'; 
    b.onclick = () => showEncyclopedia(d); 
    c.prepend(b); 
}

// =========================================================================
// === 7. 유틸리티 및 전역 바인딩 ===
// =========================================================================

function showToast(msg, type = 'info') {
    const d = document.createElement('div');
    d.className = `fixed bottom-4 right-4 px-6 py-3 rounded shadow-lg text-white font-medium z-50 transform transition-all duration-300 translate-y-10 ${type === 'error' ? 'bg-red-500' : type === 'success' ? 'bg-green-500' : 'bg-gray-800'}`;
    d.innerText = msg;
    document.body.appendChild(d);
    
    requestAnimationFrame(() => d.classList.remove('translate-y-10'));
    
    setTimeout(() => {
        d.classList.add('opacity-0', 'translate-y-10');
        setTimeout(() => d.remove(), 300);
    }, 3000);
}

function showLoader(p, t) {
    if (loadingContainer) loadingContainer.classList.remove('hidden');
    if (progressBar) progressBar.style.width = `${p}%`;
    if (loadingText) loadingText.innerText = t;
}

function hideLoader() {
    if (loadingContainer) loadingContainer.classList.add('hidden');
}

function showConfirmationModal(msg, cb) {
    if (confirmationMessage) confirmationMessage.innerText = msg;
    confirmCallback = cb;
    if (confirmationModal) {
        confirmationModal.classList.remove('hidden');
        confirmationModal.classList.add('flex');
    }
}

function hideConfirmationModal() {
    if (confirmationModal) confirmationModal.classList.add('hidden');
}

function addClickToSearch(text) {
    return text.split(' ').map(w => `<span class="clickable-word cursor-pointer hover:bg-yellow-200 rounded px-0.5 transition">${w}</span>`).join(' ');
}

function safeCreateIcons() {
    if (window.lucide) window.lucide.createIcons();
}

// 전역 함수 할당
window.speak = (t) => window.speechSynthesis.speak(new SpeechSynthesisUtterance(t));
window.startPronunciationCheck = (w) => showToast("발음 평가 기능은 준비 중입니다.", "info");

window.craftSentences = async (btn, w) => { 
    const input = btn.previousElementSibling;
    const ctx = input.value; 
    
    if (!ctx) return showToast("상황을 입력해주세요.", "warning");
    
    btn.disabled = true; 
    const originalText = btn.innerText;
    btn.innerText = "생성 중...";
    
    try {
        const res = await callGemini(`Make 3 sentences with "${w}" in context "${ctx}". JSON: [{"en":"", "ko":""}]`, true);
        const resultsContainer = document.getElementById('sentence-crafter-results');
        if (resultsContainer) {
            resultsContainer.innerHTML = res.map(s => `
                <div class="bg-white p-3 border rounded shadow-sm hover:shadow-md transition">
                    <p class="font-medium text-gray-800">${s.en}</p>
                    <p class="text-sm text-gray-500 mt-1">${s.ko}</p>
                    <button onclick="speak('${s.en.replace(/'/g, "\\'")}')" class="text-xs text-blue-500 mt-2 font-medium">🔊 듣기</button>
                </div>
            `).join('');
        }
    } catch (e) {
        showToast("생성에 실패했습니다.", "error");
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
};

window.showConceptTree = (d) => {
    if (modalContent) modalContent.innerHTML = `<h3 class="text-lg font-bold mb-2">개념 트리</h3><pre class="bg-gray-100 p-4 rounded overflow-auto text-sm max-h-[60vh]">${JSON.stringify(d, null, 2)}</pre><button onclick="hideModal()" class="mt-4 btn-3d w-full">닫기</button>`;
    if (modalContainer) {
        modalContainer.classList.remove('hidden');
        modalContainer.classList.add('flex');
    }
};

window.showEncyclopedia = (d) => {
    if (modalContent) modalContent.innerHTML = `
        <h3 class="text-xl font-bold mb-4">📖 백과사전</h3>
        <div class="h-[60vh] overflow-y-auto space-y-4 pr-2">
            <div><h4 class="font-bold text-gray-700">개요</h4><p class="text-gray-600">${d.introduction_ko}</p></div>
            <div><h4 class="font-bold text-gray-700">어원</h4><p class="text-gray-600">${d.etymology_ko}</p></div>
            <div><h4 class="font-bold text-gray-700">역사</h4><p class="text-gray-600">${d.history_ko}</p></div>
        </div>
        <button onclick="hideModal()" class="mt-4 btn-3d w-full">닫기</button>
    `;
    if (modalContainer) {
        modalContainer.classList.remove('hidden');
        modalContainer.classList.add('flex');
    }
};

window.hideModal = () => {
    if (modalContainer) modalContainer.classList.add('hidden');
    if (imageModalContainer) imageModalContainer.classList.add('hidden');
};

window.showImageModal = (s) => {
    if (modalImage) modalImage.src = s;
    if (imageModalContainer) {
        imageModalContainer.classList.remove('hidden');
        imageModalContainer.classList.add('flex');
    }
};

window.showImageAnalysisModal = async (s, w, m) => {
    window.showImageModal(s);
    showToast("이미지를 분석하고 있습니다...", "info");
};

window.handleWordClick = (e) => {
    if (e.target.classList.contains('clickable-word')) {
        const w = e.target.innerText.replace(/[^a-zA-Z]/g, "");
        if (w && searchInput) {
            searchInput.value = w;
            handleSearch(w);
        }
    }
};

window.handleWordHover = async (e) => {
    if (e.target.classList.contains('clickable-word')) {
        const w = e.target.innerText.replace(/[^a-zA-Z]/g, "");
        if (!w) return;
        
        if (!translationCache[w]) {
            try {
                translationCache[w] = await callGemini(`Translate "${w}" to Korean (one word).`);
            } catch (e) {}
        }
        
        if (translationCache[w] && wordTooltip) {
            wordTooltip.innerText = translationCache[w];
            wordTooltip.classList.remove('hidden');
            const r = e.target.getBoundingClientRect();
            wordTooltip.style.left = (r.left + window.scrollX) + "px";
            wordTooltip.style.top = (r.top + window.scrollY - 30) + "px";
        }
    }
};

window.shareApp = () => {
    navigator.clipboard.writeText(window.location.href);
    showToast("주소가 복사되었습니다!", "success");
};

window.showFileModal = () => {
    if (fileModalContainer) {
        fileModalContainer.classList.remove('hidden');
        fileModalContainer.classList.add('flex');
    }
};

window.hideFileModal = () => {
    if (fileModalContainer) fileModalContainer.classList.add('hidden');
};

window.loadWordFromList = (w, s) => {
    if (searchInput) searchInput.value = w;
    s ? checkAndLoadPage(w) : executeSearchForWord(w);
    hideListModal();
};

window.showListModal = (type) => {
    currentListType = type;
    if (listModalTitle) listModalTitle.innerText = type === 'words' ? '단어장' : '문장 보관함';
    if (listModalContainer) {
        listModalContainer.classList.remove('hidden');
        listModalContainer.classList.add('flex');
    }
    renderList();
};

window.hideListModal = () => {
    if (listModalContainer) listModalContainer.classList.add('hidden');
};

function renderList() {
    if (!listModalContent) return;
    
    let data = currentListType === 'words' ? [...savedWords] : [...savedSentences];
    
    if (currentSort === 'date-desc') data.sort((a,b) => b.timestamp - a.timestamp);
    if (currentSort === 'date-asc') data.sort((a,b) => a.timestamp - b.timestamp);
    if (currentSort === 'alpha-asc') data.sort((a,b) => (a.word||a.en).localeCompare(b.word||b.en));

    listModalContent.innerHTML = data.map(item => {
        const title = currentListType === 'words' ? item.word : item.en;
        const sub = currentListType === 'words' ? item.meaning : item.ko;
        return `
            <div class="flex items-center p-3 border-b hover:bg-gray-50">
                <input type="checkbox" class="item-checkbox mr-3 w-4 h-4" data-id="${item.id}">
                <div class="flex-grow cursor-pointer" onclick="loadWordFromList('${title}', ${currentListType === 'words'})">
                    <p class="font-bold text-gray-800">${title}</p>
                    <p class="text-sm text-gray-500">${sub}</p>
                </div>
            </div>
        `;
    }).join('');
    updateListActionButtonsState();
}

function updateListActionButtonsState() {
    if (!listModalContent) return;
    const checked = listModalContent.querySelectorAll('.item-checkbox:checked');
    const hasChecked = checked.length > 0;
    
    if (markReadBtn) markReadBtn.disabled = !hasChecked;
    if (markUnreadBtn) markUnreadBtn.disabled = !hasChecked;
    if (deleteSelectedBtn) deleteSelectedBtn.disabled = !hasChecked;
}

async function performBulkAction(action) {
    if (!userId || !listModalContent) return;
    const checked = Array.from(listModalContent.querySelectorAll('.item-checkbox:checked')).map(c => c.dataset.id);
    if (checked.length === 0) return;

    const collectionName = currentListType === 'words' ? 'history' : 'sentences';
    const batch = writeBatch(db);

    checked.forEach(id => {
        const docRef = doc(db, `artifacts/${appId}/users/${userId}/${collectionName}/${id}`);
        if (action === 'delete') batch.delete(docRef);
        else batch.update(docRef, { read: action === 'mark-read' });
    });

    try {
        await batch.commit();
        showToast("처리되었습니다.", "success");
    } catch (e) {
        showToast("처리 실패", "error");
    }
}

// 파일 업로드 처리
async function handleFileUpload() {
    if (!auth || !auth.currentUser) return showToast("로그인이 필요합니다.", "error");
    const file = fileUploadInput.files[0];
    if (!file) return showToast("파일을 선택해주세요.", "warning");
    
    const storagePath = `artifacts/${appId}/users/${userId}/files/${file.name}`;
    const storageRef = ref(storage, storagePath);
    
    const uploadProgressContainer = document.getElementById('upload-progress-container');
    const uploadProgressBar = document.getElementById('upload-progress-bar');
    
    if (uploadProgressContainer) uploadProgressContainer.classList.remove('hidden');
    if (fileUploadButton) fileUploadButton.disabled = true;
    
    const uploadTask = uploadBytesResumable(storageRef, file);
    
    uploadTask.on('state_changed', 
        (snapshot) => {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            if (uploadProgressBar) uploadProgressBar.style.width = progress + '%';
        }, 
        (error) => {
            console.error("Upload error:", error);
            showToast("업로드 실패", "error");
            if (uploadProgressContainer) uploadProgressContainer.classList.add('hidden');
            if (fileUploadButton) fileUploadButton.disabled = false;
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
            } catch (e) {
                console.error("Meta save error:", e);
                showToast("정보 저장 실패", "error");
            } finally {
                if (uploadProgressContainer) uploadProgressContainer.classList.add('hidden');
                if (fileUploadInput) fileUploadInput.value = '';
                if (fileUploadButton) fileUploadButton.disabled = false;
            }
        }
    );
}

// 실행
document.addEventListener('DOMContentLoaded', initializeFirebase);
