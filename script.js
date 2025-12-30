import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, addDoc, writeBatch, query, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject, uploadBytes } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// === GitHub Pages 배포를 위한 설정 ===
const USER_FIREBASE_CONFIG = {
 apiKey: "AIzaSyDKmpQO6htm7jZ2DByUfGnmocZP7dpTJhs",
 authDomain: "projec-48c55.firebaseapp.com",
 projectId: "projec-48c55",
 storageBucket: "projec-48c55.appspot.com",
 messagingSenderId: "376464552007",
 appId: "1:376464552007:web:929b53196fc86af19dc162",
 measurementId: "G-HMKJMNFGM4"
};

// 0. Initial Setup & Variable Declaration
let searchInput, searchButton, loadingContainer, loadingText, progressBar, searchBarContainer,
    printContainer, printContentArea, modalContainer, modalContent, imageModalContainer,
    modalImage, wordTooltip, fileModalContainer, fileUploadInput, fileUploadButton,
    listModalContainer, listModalTitle, listModalContent, sortOptions, markReadBtn,
    markUnreadBtn, deleteSelectedBtn, confirmCallback, confirmationModal,
    confirmationMessage, confirmOkBtn, confirmCancelBtn,
    searchChoiceModal, searchChoiceWord, searchChoiceLoadSavedBtn, 
    searchChoiceNewSearchBtn, searchChoiceCancelBtn,
    currentChoicePageData;

// 텍스트 생성용 Gemini API (무료/Free Tier 사용)
const textApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent`;

const translationCache = {};

// Firebase Setup
let db, auth, storage, userId;
let app;
const appId = 'default-ai-vocab-app';

// Tab Management
let tabs = {};
let activeTabId = null;
let tabCounter = 0;
let savedWords = [];
let savedSentences = [];

// =========================================================================
// === 1. 이미지 생성 함수 (Pollinations Flux 모델 적용) ===
// =========================================================================

async function callImagenWithRetry(prompt, retries = 3) {
    try {
        // ⭐️ 502 에러 방지: 프롬프트가 너무 길면 서버가 거부하므로 400자로 제한합니다.
        // Gemini가 생성한 프롬프트는 매우 긴 경우가 많아 이 과정이 필수입니다.
        const safePrompt = prompt.length > 400 ? prompt.substring(0, 400) : prompt;
        const encodedPrompt = encodeURIComponent(safePrompt);
        
        // 랜덤 시드 생성 (매번 다른 이미지)
        const randomSeed = Math.floor(Math.random() * 100000);
        
        // ⭐️ Flux 모델 설정 및 고화질 파라미터 적용
        // model=flux: 고품질 모델 사용
        // width=1024&height=1024: 고해상도
        // nologo=true: 워터마크 제거
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=flux&nologo=true&seed=${randomSeed}`;

        // 이미지를 Fetch로 가져와서 Blob으로 변환 (CORS 문제 해결 및 저장 기능 지원용)
        const response = await fetch(imageUrl);
        
        if (!response.ok) {
            throw new Error(`Image generation failed with status: ${response.status}`);
        }
        
        const blob = await response.blob();
        
        // Blob을 Base64 Data URL로 변환하여 반환
        // (기존 코드의 저장 기능이 Base64 형식을 기대하므로 변환 필요)
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
        // 실패 시 깔끔한 대체 이미지 반환
        return { 
            url: `https://placehold.co/1024x1024/e0e5ec/4a5568?text=Image+Generation+Failed`, 
            status: 'failed' 
        };
    }
}

// =========================================================================
// === 2. API Communication Wrapper ===
// =========================================================================

async function fetchWithRetry(baseUrl, payload, retries = 3) {
  const OUR_BACKEND_API = '/api/callGemini'; 
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(OUR_BACKEND_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    googleApiUrl: baseUrl,
                    payload: payload
                })
            });

            if (!response.ok) {
                const errorBody = await response.text();
                console.error(`백엔드 서버 오류: ${response.status} - ${errorBody}`);
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json(); 
        } catch (error) {
            if (i === retries - 1) {
                console.error("API 호출 최종 실패:", error);
                // showToast("AI 서버 응답에 실패했습니다. 잠시 후 다시 시도해주세요.", "error");
                throw error;
            }
            const delay = 1000 * Math.pow(2, i) + Math.random() * 1000;
            await new Promise(res => setTimeout(res, delay));
        }
    }
}

async function callGemini(prompt, isJson = false, base64Image = null) {
    const parts = [{ text: prompt }];
    if (base64Image) {
        parts.push({
            inlineData: {
                mimeType: "image/png",
                data: base64Image
            }
        });
    }
    const payload = { contents: [{ parts: parts }], };
    if (isJson) { payload.generationConfig = { responseMimeType: "application/json" }; }
    const result = await fetchWithRetry(textApiUrl, payload);
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) { console.error("Empty response from Gemini:", result); throw new Error("Gemini API response is empty."); }
    if (isJson) {
        let jsonString = text.trim();
        if (jsonString.startsWith("```json")) { jsonString = jsonString.slice(7, -3).trim(); }
        else if (jsonString.startsWith("```")) { jsonString = jsonString.slice(3, -3).trim(); }
        try { return JSON.parse(jsonString); }
        catch (error) { console.error("Failed to parse JSON:", error); console.error("Original text from API:", text); throw error; }
    }
    return text;
}

// ... (이하 코드는 기존 로직 유지) ...

function showSearchChoiceModal(word, pageData) {
    searchChoiceWord.textContent = word;
    currentChoicePageData = pageData;
    searchChoiceModal.classList.remove('hidden');
    searchChoiceModal.classList.add('flex');
    safeCreateIcons();
}

function hideSearchChoiceModal() {
    searchChoiceModal.classList.add('hidden');
    searchChoiceModal.classList.remove('flex');
    currentChoicePageData = null;
}

async function loadSavedPageFromChoice() {
    const word = searchChoiceWord.textContent;
    showToast("저장된 페이지를 불러옵니다...", "info");
    const tabId = addTab(word, true);
    const currentTab = tabs[tabId];
    currentTab.fullSearchResult = currentChoicePageData;
    await renderSavedPage(currentTab, currentChoicePageData);
    hideSearchChoiceModal();
}

function renderFileList(files) {
    const fileListDiv = document.getElementById('file-list');
    if (files.length === 0) {
        fileListDiv.innerHTML = '<p class="text-center text-gray-500">업로드된 파일이 없습니다.</p>';
        return;
    }
    fileListDiv.innerHTML = '';
    files.sort((a, b) => (b.timestamp?.toDate() || 0) - (a.timestamp?.toDate() || 0));

    files.forEach(fileData => {
        const fileElement = document.createElement('div');
        fileElement.className = 'flex items-center justify-between p-2 rounded-lg hover:bg-slate-200';
        fileElement.innerHTML = `
            <div class="truncate">
                <p class="font-semibold truncate">${fileData.name}</p>
                <p class="text-sm text-gray-500">${(fileData.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
                <button class="icon-btn" onclick="downloadFile('${fileData.fullPath}')">${createDownloadIcon()}</button>
                <button class="icon-btn text-red-500" onclick="deleteFile('${fileData.id}', '${fileData.fullPath}')">${createTrashIcon()}</button>
            </div>
        `;
        fileListDiv.appendChild(fileElement);
    });
    safeCreateIcons();
}

function showToast(message, type = "info") {
    const toast = document.getElementById('toast-container');
    const toastMessage = document.getElementById('toast-message');
    toastMessage.textContent = message;

    toast.className = 'toast show fixed bottom-24 right-5 text-white px-6 py-3 rounded-lg shadow-lg';
    if (type === 'success') toast.classList.add('bg-green-600');
    else if (type === 'error') toast.classList.add('bg-red-600');
    else if (type === 'warning') toast.classList.add('bg-yellow-500');
    else toast.classList.add('bg-gray-800');

    setTimeout(() => { toast.className = 'toast'; }, 3000);
}

function loadUserLists() {
    if (!db || !userId) return;
    const wordsQuery = query(collection(db, `artifacts/${appId}/users/${userId}/saved_words`));
    onSnapshot(wordsQuery, (snapshot) => {
        savedWords = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if(window.currentListType === 'words') window.renderList();
    }, (error) => console.error("Error loading words:", error));

    const sentencesQuery = query(collection(db, `artifacts/${appId}/users/${userId}/saved_sentences`));
    onSnapshot(sentencesQuery, (snapshot) => {
        savedSentences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if(window.currentListType === 'sentences') window.renderList();
    }, (error) => console.error("Error loading sentences:", error));
}

function listenForFiles() {
    if (!db || !userId) return;
    const filesQuery = query(collection(db, `artifacts/${appId}/users/${userId}/file_metadata`));
    onSnapshot(filesQuery, (snapshot) => {
        const files = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderFileList(files);
    }, (error) => {
        console.error("Error listening for files:", error);
        const fileListDiv = document.getElementById('file-list');
        fileListDiv.innerHTML = '<p class="text-center text-red-500">파일 목록을 불러오는 데 실패했습니다.</p>';
    });
}

function safeCreateIcons() {
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

function base64ToBlob(base64, contentType = 'image/png') {
    const base64Data = base64.split(',')[1];
    if (!base64Data) {
        throw new Error("Invalid base64 string");
    }
    const sliceSize = 512;
    const byteCharacters = atob(base64Data);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
        const slice = byteCharacters.slice(offset, offset + sliceSize);
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
            byteNumbers[i] = slice.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, {type: contentType});
}

async function uploadBase64Image(base64String, storagePath) {
    const blob = base64ToBlob(base64String);
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, blob); 
    return await getDownloadURL(storageRef);
}

// =========================================================================

async function initializeFirebase() {
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
    confirmCallback = null;

    searchChoiceModal = document.getElementById('search-choice-modal');
    searchChoiceWord = document.getElementById('search-choice-word');
    searchChoiceLoadSavedBtn = document.getElementById('search-choice-load-saved-btn');
    searchChoiceNewSearchBtn = document.getElementById('search-choice-new-search-btn');
    searchChoiceCancelBtn = document.getElementById('search-choice-cancel-btn');
    currentChoicePageData = null;

    const firebaseConfig = USER_FIREBASE_CONFIG;
    try {
        if (!firebaseConfig.apiKey) {
            console.error("Firebase config is missing.");
            showToast("Firebase 구성 정보가 누락되었습니다.", "error");
            document.getElementById('app-container').style.visibility = 'visible';
            return;
        }
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        storage = getStorage(app,"gs://projec-48c55.firebasestorage.app");
        setLogLevel('debug'); 
          
     onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                console.log("Authenticated with Google. User ID:", userId);
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

                if (window.location.pathname.startsWith('/__/auth/handler')) {
                    window.history.replaceState({}, document.title, '/');
                }

            } else {
                userId = null;
                console.log("User is signed out.");
                document.getElementById('auth-status').innerHTML = `
                    <span class="text-sm">로그인이 필요합니다.</span>
                `;
                
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
        console.error("Firebase Initialization Error: ", error);
        showToast("데이터베이스 연결 또는 인증에 실패했습니다.", "error");
        document.getElementById('app-container').style.visibility = 'visible';
        document.getElementById('auth-container').classList.add('hidden'); 
    }

    confirmOkBtn.addEventListener('click', () => { if (confirmCallback) { confirmCallback(); } hideConfirmationModal(); });
    confirmCancelBtn.addEventListener('click', hideConfirmationModal);

    searchChoiceLoadSavedBtn.addEventListener('click', loadSavedPageFromChoice);
    searchChoiceNewSearchBtn.addEventListener('click', () => {
        const word = searchChoiceWord.textContent;
        executeSearchForWord(word); 
        hideSearchChoiceModal();
    });
    searchChoiceCancelBtn.addEventListener('click', hideSearchChoiceModal);

    fileUploadButton.addEventListener('click', () => { 
        if (!auth || !auth.currentUser) { showToast("Firebase에 연결되지 않았습니다.", "error"); return; } 
        const file = fileUploadInput.files[0]; 
        if (!file) { showToast("파일을 선택해주세요.", "warning"); return; } 
        if (file.size > 50 * 1024 * 1024) { showToast("파일 크기는 50MB를 초과할 수 없습니다.", "error"); return; } 
        const storagePath = `artifacts/${appId}/users/${userId}/files/${file.name}`; 
        const storageRef = ref(storage, storagePath); 
        const uploadProgressContainer = document.getElementById('upload-progress-container'); 
        const uploadProgressBar = document.getElementById('upload-progress-bar'); 
        uploadProgressContainer.classList.remove('hidden'); 
        fileUploadButton.disabled = true; 
        const uploadTask = uploadBytesResumable(storageRef, file); 
        uploadTask.on('state_changed', 
            (snapshot) => { const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100; uploadProgressBar.style.width = progress + '%'; }, 
            (error) => { console.error("Upload failed. Firebase Error Code:", error.code); console.error("Full Error:", error); showToast(`파일 업로드 실패: ${error.code}`, "error"); uploadProgressContainer.classList.add('hidden'); uploadProgressBar.style.width = '0%'; fileUploadButton.disabled = false; }, 
            async () => { 
                let firestoreError = null; 
                try { 
                    const metadata = uploadTask.snapshot.metadata; 
                    await addDoc(collection(db, `artifacts/${appId}/users/${userId}/file_metadata`), { name: metadata.name, fullPath: metadata.fullPath, size: metadata.size, contentType: metadata.contentType, timestamp: new Date() }); 
                } catch (error) { 
                    firestoreError = error; console.error("Firestore metadata save error:", error.code, error.message); showToast(`파일 정보 저장 실패: ${error.code}`, "error"); 
                    await deleteObject(uploadTask.snapshot.ref).catch(err => console.error("Orphaned file cleanup failed:", err)); 
                } finally { 
                    uploadProgressContainer.classList.add('hidden'); uploadProgressBar.style.width = '0%'; fileUploadInput.value = ''; fileUploadButton.disabled = false; 
                    if (!firestoreError) { showToast("파일 업로드 성공.", "success"); } 
                } 
            }
        ); 
    });

    listModalContent.addEventListener('change', (e) => { if (e.target.classList.contains('item-checkbox')) { updateListActionButtonsState(); } });

    document.addEventListener('mouseover', async (e) => { 
        if (e.target.classList.contains('clickable-word') && userId) { 
            const word = e.target.textContent.trim().replace(/[^a-zA-Z-]/g, ''); 
            if (!word) return; 
            const translation = await translateWordOnHover(word); 
            wordTooltip.textContent = translation; 
            wordTooltip.classList.remove('hidden'); 
            const rect = e.target.getBoundingClientRect(); 
            wordTooltip.style.left = `${rect.left + window.scrollX + rect.width / 2 - wordTooltip.offsetWidth / 2}px`; 
            wordTooltip.style.top = `${rect.top + window.scrollY - wordTooltip.offsetHeight - 5}px`; 
        } 
    });

    document.addEventListener('mouseout', (e) => { if (e.target.classList.contains('clickable-word')) { wordTooltip.classList.add('hidden'); } });

    document.addEventListener('click', (e) => { 
        if (e.target.classList.contains('clickable-word') && userId) { 
            const word = e.target.textContent.trim().replace(/[^a-zA-Z-]/g, ''); 
            if (word) { 
                searchInput.value = word; 
                checkAndLoadPage(word); 
                hideListModal(); 
            } 
        } 
        const listItemTarget = e.target.closest('.searchable-list-item'); 
        if (listItemTarget) { 
            const word = listItemTarget.dataset.word; 
            if(word) {
                searchInput.value = word;
                checkAndLoadPage(word);
                hideListModal(); 
            }
        }
    });

    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && userId) { handleSearch(searchInput.value.trim()); } });
    document.getElementById('word-list-btn').addEventListener('click', () => showListModal('words'));
    document.getElementById('sentence-list-btn').addEventListener('click', () => showListModal('sentences'));
    document.getElementById('file-storage-btn').addEventListener('click', showFileModal);
    document.getElementById('share-btn').addEventListener('click', () => { if(navigator.share) { navigator.share({ title: 'AI Vocabulary Builder', text: 'AI와 함께 새로운 단어를 배워보세요!', url: window.location.href }).catch(err => console.error("Share failed", err)); } else { try { navigator.clipboard.writeText(window.location.href); showToast("링크가 클립보드에 복사되었습니다.", "success"); } catch (err) { console.error("Clipboard write failed:", err); showToast("클립보드 복사 실패.", "error"); } } });
    sortOptions.addEventListener('change', (e) => { currentSort = e.target.value; renderList(); });
    markReadBtn.addEventListener('click', () => performBulkAction('mark-read'));
    markUnreadBtn.addEventListener('click', () => performBulkAction('mark-unread')); 
    deleteSelectedBtn.addEventListener('click', () => performBulkAction('delete'));

} 

window.signInWithGoogle = async function() {
    const provider = new GoogleAuthProvider();
    try {
        const result = await signInWithPopup(auth, provider);
        console.log("Popup Sign-In successful:", result.user.displayName);
        showToast(`${result.user.displayName}님, 환영합니다!`, "success");
    } catch (error) {
        console.error("Google Sign-In Popup Error:", error);
        if (error.code !== 'auth/popup-closed-by-user') {
            showToast("Google 팝업 로그인에 실패했습니다.", "error");
        }
    }
}

// ---------------------------
// Core Logic
// ---------------------------

window.checkSearchAccess = function() {
    handleSearch(searchInput.value.trim());
}

async function checkAndLoadPage(word) {
    if (!db || !userId) {
        showToast("DB 연결 오류", "error");
        executeSearchForWord(word); 
        return;
    }
    const normalizedWord = word.toLowerCase();
    const pageRef = doc(db, `artifacts/${appId}/users/${userId}/saved_pages/${normalizedWord}`);
    
    try {
        const docSnap = await getDoc(pageRef);
        if (docSnap.exists()) {
            const pageData = docSnap.data().pageData;
            showSearchChoiceModal(word, pageData);
        } else {
            executeSearchForWord(word);
        }
    } catch (error) {
        console.error("Error checking for saved page:", error);
        showToast("저장된 페이지 확인 중 오류 발생. 새 검색을 시작합니다.", "error");
        executeSearchForWord(word); 
    }
}


async function handleSearch(query) {
    if (!userId) { showToast("로그인이 필요합니다.", "error"); return; } 
    if (!query) { showToast("검색어를 입력해주세요.", "warning"); return; }
    
    const isKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(query);
    if (isKorean) {
        showLoader(0, `'${query}'에 대한 의미 확인 중...`);
        try {
            const ambiguityPrompt = `한국어 단어 "${query}"가 여러 개의 뚜렷하게 다른 영어 단어로 번역될 수 있나요? (예: '배' -> ship, pear, stomach). 다음 JSON 형식으로만 대답해줘: {"is_ambiguous": boolean, "english_words": ["단어1", "단어2", ...]}. 모호하지 않으면 "english_words" 배열에 대표 영어 단어 하나만 포함해줘.`;
            const ambiguityData = await callGemini(ambiguityPrompt, true);
            
            const normalizedEnglishWords = ambiguityData.english_words
                .filter(word => word) 
                .map(word => word.toLowerCase().trim()); 
                
            const uniqueEnglishWords = [...new Set(normalizedEnglishWords)]; 
            
            if (ambiguityData.is_ambiguous && uniqueEnglishWords.length > 1) {
                showToast(`'${query}'에 대해 ${uniqueEnglishWords.length}개의 의미를 찾았습니다. 각각 탭으로 표시합니다.`, "info");
                for (let i = 0; i < uniqueEnglishWords.length; i++) {
                    const word = uniqueEnglishWords[i];
                    await checkAndLoadPage(word);
                }
            } else { 
                const wordToSearch = uniqueEnglishWords[0] || query;
                await checkAndLoadPage(wordToSearch); 
            }
        } catch (error) { 
            console.error("Ambiguity check failed:", error); 
            showToast("단어 의미 확인 중 오류가 발생했습니다.", "error"); 
            await checkAndLoadPage(query); 
        }
        finally { hideLoader(); }
    } else { 
        await checkAndLoadPage(query); 
    }
}

async function executeSearchForWord(wordQuery, makeActive = true) {
    const tabId = addTab(wordQuery, makeActive);
    const currentTab = tabs[tabId];
    const contentContainer = currentTab.contentEl;
    contentContainer.innerHTML = '';
    const searchId = ++currentTab.searchId;
    currentTab.fullSearchResult = {};
    currentTab.imageLoadPromises = []; 
    showLoader(0, `"${wordQuery}" 검색을 시작합니다...`);
    searchButton.disabled = true;
    const headerHeight = document.querySelector('header').offsetHeight || 100;
    window.scrollTo({ top: headerHeight, behavior: 'smooth' });
    try {
        updateLoader(10, "기본 정보 생성 중...");
        const initialInfoPrompt = `영어 단어 "${wordQuery}"에 대한 종합적인 정보를 생성해줘. 다음 JSON 형식을 반드시 따라줘:\n{\n  "word": "실제 영어 단어 (소문자로)",\n  "koreanMeaning": "대표적인 한글 뜻",\n  "pronunciation": "발음 기호",\n  "mainImagePrompt": "단어를 함축적으로 표현하는, 예술적이고 상세한 이미지 생성을 위한 영어 프롬프트. 예: 'brain' -> 'A hyper-realistic, detailed anatomical illustration of the human brain, showing different lobes with glowing neural pathways, artistic style.'",\n  "episode": {\n    "story": "단어를 쉽게 기억할 수 있는 매우 웃기고 재미있는 짧은 이야기 (3~4 문장).",\n    "story_ko": "위 이야기의 자연스러운 한글 번역.",\n    "imagePrompt": "이야기 내용에 맞는, 밝고 유머러스한 만화 스타일의 이미지 생성을 위한 영어 프롬프트. 예: 'Dr. Slump' 만화 스타일."\n  }\n}`;
        const initialData = await callGemini(initialInfoPrompt, true);
        
        initialData.word = initialData.word.toLowerCase();
        
        currentTab.fullSearchResult.initialData = initialData;
        if (searchId !== currentTab.searchId) return;
        updateLoader(25, "기본 정보 표시 중...");
        
        renderPrintButton(currentTab);
        renderSavePageButton(currentTab); 
        
        const placeholderImg = "https://placehold.co/300x300/e0e5ec/4a5568?text=Loading...";
        renderBasicInfo(initialData, placeholderImg, contentContainer);
        renderEpisode(initialData, placeholderImg, contentContainer);
        addWordToHistory(initialData.word, initialData.koreanMeaning);
        
        const mainImagePromise = new Promise((resolve, reject) => {
            callImagenWithRetry(initialData.mainImagePrompt).then(imageResult => {
                currentTab.fullSearchResult.mainImageUrl = imageResult.url; 
                if (searchId === currentTab.searchId) {
                    const imgEl = contentContainer.querySelector('#main-image');
                    if (imgEl) {
                        imgEl.onload = () => resolve({ type: 'main', ...imageResult });
                        imgEl.onerror = () => reject(new Error('Main image load fail'));
                        imgEl.src = imageResult.url;
                        if (imageResult.status === 'success') { imgEl.onclick = () => showImageAnalysisModal(imageResult.url, initialData.word, initialData.koreanMeaning); }
                        else if (imageResult.status === 'policy_failed') { imgEl.title = "정책 필터링으로 인해 이미지를 표시할 수 없습니다."; imgEl.onclick = () => showToast("경고: 이미지가 정책에 의해 필터링되었습니다.", "warning"); }
                        else { imgEl.title = "이미지 생성에 실패했습니다."; imgEl.onclick = () => showToast("경고: 이미지 생성에 실패했습니다.", "error"); }
                    } else { reject(new Error('Main image element not found')); }
                } else { reject(new Error('Tab changed')); }
            }).catch(e => reject(e));
        });
        currentTab.imageLoadPromises.push(mainImagePromise);
        
        const episodeImagePromise = new Promise((resolve, reject) => {
             callImagenWithRetry(initialData.episode.imagePrompt).then(imageResult => {
                currentTab.fullSearchResult.episodeImageUrl = imageResult.url; 
                if (searchId === currentTab.searchId) {
                    const imgEl = contentContainer.querySelector('#episode-image');
                    if (imgEl) {
                        imgEl.onload = () => resolve({ type: 'episode', ...imageResult });
                        imgEl.onerror = () => reject(new Error('Episode image load fail'));
                        imgEl.src = imageResult.url;
                        imgEl.onclick = () => showImageModal(imageResult.url); 
                    } else { reject(new Error('Episode image element not found')); }
                } else { reject(new Error('Tab changed')); }
            }).catch(e => reject(e));
        });
        currentTab.imageLoadPromises.push(episodeImagePromise);

        updateLoader(40, "의미 분석 생성 중...");
        const meaningsPrompt = `영어 단어 "${initialData.word}"의 의미를 분석해줘. 핵심 의미, 부가적 의미, 숙어 표현 각각에 대해 설명과 대표 예문, 그리고 그 예문에 맞는 'Dr. Slump' 스타일의 재미있는 삽화 프롬프트를 생성해줘. 다음 JSON 형식을 반드시 따라줘:\n[\n  { "type": "핵심 의미", "description": "핵심 의미에 대한 자세한 한글 설명.", "exampleSentence": "의미를 가장 잘 나타내는 현대적이고 일반적인 영어 예문.", "exampleSentenceTranslation": "위 예문의 한글 번역.", "imagePrompt": "위 예문 내용을 기반으로, 'Dr.slump' 만화 스타일의 재미있는 삽화 생성을 위한 영어 프롬프트. 인물 표정은 다양하고 재미있게." },\n  { "type": "부가적 의미", "description": "부가적, 비유적, 확장된 의미에 대한 한글 설명.", "exampleSentence": "해당 의미를 보여주는 창의적인 영어 예문.", "exampleSentenceTranslation": "위 예문의 한글 번역.", "imagePrompt": "위 예문 내용을 기반으로 한 삽화 프롬프트." },\n  { "type": "숙어 표현", "description": "단어가 포함된 중요 숙어와 그 의미에 대한 한글 설명.", "exampleSentence": "숙어가 사용된 자연스러운 영어 예문.", "exampleSentenceTranslation": "위 예문의 한글 번역.", "imagePrompt": "위 예문 내용을 기반으로 한 삽화 프롬프트." }\n]`;
        const meaningsData = await callGemini(meaningsPrompt, true);
        currentTab.fullSearchResult.meaningsData = meaningsData;
        if (searchId !== currentTab.searchId) return;
        
        await renderMeanings(meaningsData, initialData.word, searchId, currentTab, contentContainer);
        
        renderSentenceCrafter(initialData.word, contentContainer);
        updateLoader(75, "심화 학습 정보 생성 중...");
        const fastDeepDivePrompt = `영어 단어 "${initialData.word}"에 대한 심화 학습 콘텐츠를 생성해줘. "encyclopedia"는 제외하고 다음 JSON 형식을 반드시 따라줘:\n{\n  "quotes": [\n    {"quote": "관련 명언/유명 문구 1", "translation": "한글 번역"},\n    {"quote": "관련 명언/유명 문구 2", "translation": "한글 번역"},\n    {"quote": "관련 명언/유명 문구 3", "translation": "한글 번역"}\n  ],\n  "synonyms": ["유의어1(뜻1)", "유의어2(뜻2)", "유의어3(뜻3)"],\n  "antonyms": ["반의어1(뜻1)", "반의어2(뜻2)"],\n  "conceptTree": { "superordinate": ["상위 개념 (영어(한글))"], "coordinate": ["동위 개념 1 (영어(한글))", "...(총 10개)"], "subordinate": ["하위 개념 1 (영어(한글))", "...(총 20개)"] },\n  "dialogue": [\n    {"speaker": "A", "line": "대화 문장 1 (영어)", "translation": "대화 문장 1 (한글)"},\n    {"speaker": "B", "line": "대화 문장 2 (영어)", "translation": "대화 문장 2 (한글)"}\n  ],\n  "quiz": [\n    { "question": "난이도 높은 4지선다 퀴즈 문제 1", "options": ["선택지 A", "선택지 B", "선택지 C", "선택지 D"], "answer": "정답 선택지", "explanation": "정답에 대한 상세한 한글 해설. 퀴즈 문제 문장에 대한 한글 해석을 반드시 포함해야 합니다." }\n  ]\n}`;
        const fastDeepDiveData = await callGemini(fastDeepDivePrompt, true);
        currentTab.fullSearchResult.fastDeepDiveData = fastDeepDiveData;
        if (searchId !== currentTab.searchId) return;
        updateLoader(90, "심화 정보 표시 중...");
        const buttonContainer = renderDeepDiveButtonsContainer(contentContainer);
        appendConceptTreeButton(buttonContainer, fastDeepDiveData.conceptTree);
        renderDeepDive(fastDeepDiveData, contentContainer);
        
        Promise.all(currentTab.imageLoadPromises.map(p => p.catch(e => e)))
            .then(results => {
                console.log("All image generation/loads complete:", results);
                if (searchId === currentTab.searchId) {
                    const saveButton = currentTab.contentEl.querySelector(`#save-page-btn-${currentTab.id}`);
                    if (saveButton) {
                        saveButton.disabled = false;
                        saveButton.innerHTML = `💾 이 페이지 저장하기`;
                        safeCreateIcons();
                    }
                }
            });

        hideLoader();
        showToast("핵심 정보 로딩 완료! 백과사전 정보를 생성합니다...", "info");
        const encyclopediaPrompt = `영어 단어 "${initialData.word}"에 대한 백과사전식 설명을 생성해줘. A4 용지 3장 분량에 준하는 상세한 내용이어야 하며, '어원', '역사적 배경', '문학/현대에서의 사용' 섹션을 포함하여 구조화해줘. 다음 JSON 형식만 따라줘:\n{ \n  "encyclopedia": { \n    "introduction": "상세한 서론 (영어, 여러 문단)", "etymology": "깊이 있는 어원 분석 (영어, 여러 문단)", "history": "포괄적인 역사적 배경과 변화 과정 (영어, 여러 문단)", "usage": "문학, 현대 미디어, 일상에서의 사용 예시 (영어, 여러 문단)",\n    "introduction_ko": "위 내용의 한글 번역", "etymology_ko": "위 내용의 한글 번역", "history_ko": "위 내용의 한글 번역", "usage_ko": "위 내용의 한글 번역"\n  }\n}`;
        const encyclopediaFullData = await callGemini(encyclopediaPrompt, true);
        if (searchId !== currentTab.searchId) return;
        currentTab.fullSearchResult.encyclopediaData = encyclopediaFullData;
        appendEncyclopediaButton(buttonContainer, encyclopediaFullData.encyclopedia);
        showToast("모든 콘텐츠 생성이 완료되었습니다!", "success");
        const printButton = currentTab.contentEl.querySelector(`#print-btn-${currentTab.id}`);
        if (printButton) { printButton.disabled = false; printButton.innerHTML = `<i data-lucide="printer" class="inline-block mr-2"></i>결과 인쇄하기`; safeCreateIcons(); }
    } catch (error) { console.error("Search failed:", error); showToast("콘텐츠 생성 중 오류가 발생했습니다.", "error"); hideLoader(); contentContainer.innerHTML = `<div class="card p-8 text-center text-red-500"><p>검색 결과를 불러오는 데 실패했습니다.</p><p class="text-sm text-gray-500 mt-2">존재하지 않는 단어이거나, 네트워크 문제일 수 있습니다.</p></div>`; }
    finally { searchButton.disabled = false; }
}

async function renderSavedPage(tab, pageData) {
    const contentContainer = tab.contentEl;
    contentContainer.innerHTML = '';
    
    try {
        renderDeletePageButton(contentContainer, pageData.initialData.word);

        renderBasicInfo(pageData.initialData, pageData.mainImageUrl, contentContainer);
        const mainImgEl = contentContainer.querySelector('#main-image');
        if (mainImgEl) {
            mainImgEl.onclick = () => showImageAnalysisModal(pageData.mainImageUrl, pageData.initialData.word, pageData.initialData.koreanMeaning);
        }

        renderEpisode(pageData.initialData, pageData.episodeImageUrl, contentContainer);

        renderSavedMeanings(pageData.meaningsData, pageData.initialData.word, contentContainer);

        renderSentenceCrafter(pageData.initialData.word, contentContainer);

        const buttonContainer = renderDeepDiveButtonsContainer(contentContainer);
        if (pageData.fastDeepDiveData && pageData.fastDeepDiveData.conceptTree) {
            appendConceptTreeButton(buttonContainer, pageData.fastDeepDiveData.conceptTree);
        }
        if (pageData.encyclopediaData && pageData.encyclopediaData.encyclopedia) {
            appendEncyclopediaButton(buttonContainer, pageData.encyclopediaData.encyclopedia);
        }
        if (pageData.fastDeepDiveData) {
            renderDeepDive(pageData.fastDeepDiveData, contentContainer);
        }
        
        showToast("저장된 페이지를 불러왔습니다.", "success");
        safeCreateIcons();
    } catch (error) {
        console.error("Error rendering saved page:", error);
        contentContainer.innerHTML = `<div class="card p-8 text-center text-red-500"><p>저장된 페이지를 불러오는 데 실패했습니다.</p></div>`;
    }
}

function renderSavePageButton(tab) {
    const saveButton = document.createElement('button');
    saveButton.id = `save-page-btn-${tab.id}`;
    saveButton.className = 'btn-3d mb-4 ml-4';
    saveButton.disabled = true; 
    saveButton.innerHTML = `<div class="loader w-5 h-5 border-2 border-t-blue-500 inline-block mr-2 animate-spin"></div>이미지 로딩 중...`;
    saveButton.onclick = () => saveCurrentPage(tab.id);
    const printButton = tab.contentEl.querySelector(`#print-btn-${tab.id}`);
    if (printButton) {
        printButton.insertAdjacentElement('afterend', saveButton);
    } else {
        tab.contentEl.prepend(saveButton);
    }
    safeCreateIcons();
}

function renderDeletePageButton(container, word, replaceButtonId = null) {
    const deleteButton = document.createElement('button');
    deleteButton.id = `delete-page-btn-${word}`;
    deleteButton.className = 'btn-3d mb-4 !bg-red-500 !text-white hover:!bg-red-600';
    deleteButton.innerHTML = `🗑️ 저장된 페이지 삭제`;
    deleteButton.onclick = () => deleteSavedPage(word);
    
    if (replaceButtonId) {
        const oldButton = document.getElementById(replaceButtonId);
        if (oldButton) {
            oldButton.replaceWith(deleteButton);
        } else {
            container.prepend(deleteButton);
        }
    } else {
        container.prepend(deleteButton);
    }
    safeCreateIcons();
}

// ---------------------------
// Rendering Functions
// ---------------------------
function renderPrintButton(tab) { const printButton = document.createElement('button'); printButton.id = `print-btn-${tab.id}`; printButton.className = 'btn-3d mb-4'; printButton.disabled = true; printButton.innerHTML = `<div class="loader w-5 h-5 border-2 border-t-blue-500 inline-block mr-2 animate-spin"></div>인쇄 준비 중...`; printButton.onclick = () => handlePrint(tab.id); tab.contentEl.prepend(printButton); safeCreateIcons(); }
window.renderBasicInfo = function(data, imageUrl, container) { const html = `<div class="card p-6"><div class="flex flex-col md:flex-row items-center gap-6"><div class="w-full md:w-2/5"><img id="main-image" src="${imageUrl}" alt="${data.word}" class="rounded-lg shadow-lg w-full h-auto object-cover clickable-image"></div><div class="w-full md:w-3/5"><div class="flex items-center gap-4 mb-4"><h2 class="text-5xl font-bold">${data.word}</h2><button onclick="speak('${data.word}', 'en-US')" class="btn-3d p-3">${createVolumeIcon()}</button><button id="pronunciation-btn" class="btn-3d p-3 text-purple-600" onclick="startPronunciationCheck('${data.word}')">✨ 발음 피드백</button></div><div class="flex items-center gap-2"><p class="text-2xl text-gray-600">${data.koreanMeaning}</p><button onclick="speak('${data.koreanMeaning}', 'ko-KR')" class="btn-3d p-3">${createVolumeIcon()}</button></div><p class="text-lg text-gray-500 mt-2">[${data.pronunciation}]</p><div id="pronunciation-feedback" class="mt-4 p-3 rounded-lg bg-yellow-100 text-yellow-700 hidden"></div></div></div></div>`; container.insertAdjacentHTML('beforeend', html); safeCreateIcons(); }
window.renderEpisode = function(data, imageUrl, container) { const { episode, word } = data; const html = `<div class="card p-6"><h3 class="text-2xl font-bold mb-4 flex items-center"><i data-lucide="sparkles" class="mr-2 text-yellow-500"></i>재미있는 에피소드</h3><img id="episode-image" src="${imageUrl}" alt="Episode illustration" class="rounded-lg shadow-md w-full h-auto object-cover mb-4 max-w-sm mx-auto clickable-image"><div class="space-y-2"><p class="text-lg leading-relaxed">${addClickToSearch(episode.story)}</p><p class="text-md leading-relaxed text-gray-600">${episode.story_ko}</p></div><div class="mt-4 flex flex-col sm:flex-row gap-2"><button class="icon-btn" onclick="speak('${episode.story.replace(/'/g, "\\'")}', 'en-US')">${createVolumeIcon('w-5 h-5')}<span class="tooltip">영어 듣기</span></button><button class="icon-btn" onclick="speak('${episode.story_ko.replace(/'/g, "\\'")}', 'ko-KR')">${createVolumeIcon('w-5 h-5')}<span class="tooltip">한국어 듣기</span></button><button class="btn-3d flex-grow" onclick="expandStory(this, '${word}', '${episode.story.replace(/'/g, "\\'")}', '${episode.story_ko.replace(/'/g, "\\'")}')">✨ 이야기 더 만들기</button></div></div>`; container.insertAdjacentHTML('beforeend', html); safeCreateIcons(); }
window.renderDeepDiveButtonsContainer = function(container) { const btnContainer = document.createElement('div'); btnContainer.id = 'deep-dive-buttons'; btnContainer.className = 'card p-6 grid grid-cols-1 sm:grid-cols-2 gap-4'; container.appendChild(btnContainer); return btnContainer; }
window.appendConceptTreeButton = function(container, conceptTreeData) { const conceptTreeBtn = document.createElement('button'); conceptTreeBtn.id = 'concept-tree-btn'; conceptTreeBtn.className = 'btn-3d w-full'; conceptTreeBtn.textContent = '개념 트리 보기'; conceptTreeBtn.onclick = () => showConceptTree(conceptTreeData); container.appendChild(conceptTreeBtn); }
window.appendEncyclopediaButton = function(container, encyclopediaData) { const encyclopediaBtn = document.createElement('button'); encyclopediaBtn.id = 'encyclopedia-btn'; encyclopediaBtn.className = 'btn-3d w-full'; encyclopediaBtn.textContent = '백과사전식 설명 보기'; encyclopediaBtn.onclick = () => showEncyclopedia(encyclopediaData); container.prepend(encyclopediaBtn); }

window.renderMeanings = async function(meanings, word, searchId, currentTab, mainContainer) {
    const container = document.createElement('div'); container.className = 'card p-6 space-y-8'; container.innerHTML = `<h3 class="text-2xl font-bold mb-4 flex items-center"><i data-lucide="book-open-check" class="mr-2 text-green-600"></i>의미 분석</h3>`; mainContainer.appendChild(container);
    for (const [index, meaning] of meanings.entries()) {
        if (currentTab.searchId !== searchId) return;
        const element = document.createElement('div'); element.className = 'border-t border-slate-300 pt-6';
        const placeholderImg = "https://placehold.co/300x300/e0e5ec/4a5568?text=Loading...";
        element.innerHTML = `<h4 class="text-xl font-semibold text-blue-700">${meaning.type}</h4><img id="meaning-image-${index}" src="${placeholderImg}" alt="${meaning.type}" class="rounded-lg shadow-md w-full h-auto object-cover mb-4 max-w-sm mx-auto clickable-image"><p class="text-gray-600 my-2">${meaning.description}</p>`;
        container.appendChild(element); 
        
        const imgEl = element.querySelector(`#meaning-image-${index}`);
        const meaningImagePromise = new Promise((resolve, reject) => {
            callImagenWithRetry(meaning.imagePrompt).then(imageResult => {
                if (currentTab.searchId === searchId) {
                    if (currentTab.fullSearchResult.meaningsData?.[index]) { currentTab.fullSearchResult.meaningsData[index].imageUrl = imageResult.url; }
                    
                    imgEl.onload = () => resolve({ type: 'meaning', index, ...imageResult });
                    imgEl.onerror = () => reject(new Error(`Meaning image ${index} load fail`));
                    imgEl.src = imageResult.url;

                    if (imageResult.status === 'success') { imgEl.onclick = () => showImageModal(imageResult.url); }
                    else { imgEl.title = "이미지 생성에 실패했습니다."; imgEl.onclick = () => showToast("경고: 이미지 생성에 실패했습니다.", "error"); }
                } else { reject(new Error('Tab changed')); }
            }).catch(error => { console.error(`Failed to load image for meaning ${index}:`, error); imgEl.src = `https://placehold.co/300x300/e74c3c/ffffff?text=Image+Load+Failed`; reject(error); });
        });
        currentTab.imageLoadPromises.push(meaningImagePromise);
        
        const examplesPrompt = `영어 단어 "${word}"의 "${meaning.description}" 의미와 관련된, 현대적이고 유용한 영어 예문 5개와 각각의 한글 번역을 생성해줘. 다음 JSON 형식을 반드시 따라줘:\n[\n  {"en": "Example sentence 1.", "ko": "예문 1 한글 번역."},\n  {"en": "Example sentence 2.", "ko": "예문 2 한글 번역."}\n]`;
        const examples = await callGemini(examplesPrompt, true);
        if (currentTab.searchId !== searchId) return;
        if (currentTab.fullSearchResult.meaningsData?.[index]) { currentTab.fullSearchResult.meaningsData[index].examples = examples; }
        const examplesHtml = examples.map((ex, i) => `<li class="flex items-start justify-between gap-3 mt-2"><div class="flex items-start"><span class="text-gray-500 mr-2">${i + 1}.</span><div><p class="text-md font-medium">${addClickToSearch(ex.en)}</p><p class="text-sm text-gray-500">${ex.ko}</p></div></div><div class="flex items-center flex-shrink-0 gap-1"><button class="icon-btn" onclick="speak('${ex.en.replace(/'/g, "\\'")}', 'en-US')">${createVolumeIcon('w-5 h-5')}<span class="tooltip">영어 듣기</span></button><button class="icon-btn" onclick="speak('${ex.ko.replace(/'/g, "\\'")}', 'ko-KR')">${createVolumeIcon('w-5 h-5')}<span class="tooltip">한국어 듣기</span></button><button class="icon-btn" onclick="saveSentence('${ex.en.replace(/'/g, "\\'")}', '${ex.ko.replace(/'/g, "\\'")}')">${createSaveIcon('w-5 h-5')}<span class="tooltip">저장하기</span></button></div></li>`).join('');
        element.innerHTML += `<p class="font-medium mt-4 mb-2">대표 예문:</p><div class="bg-slate-200 p-4 rounded-lg"><div><p class="text-lg font-semibold">${addClickToSearch(meaning.exampleSentence)}</p><p class="text-md text-gray-600">${meaning.exampleSentenceTranslation}</p></div><div class="flex items-center gap-2 mt-2"><button class="icon-btn" onclick="speak('${meaning.exampleSentence.replace(/'/g, "\\'")}', 'en-US')">${createVolumeIcon('w-5 h-5')}<span class="tooltip">영어 듣기</span></button><button class="icon-btn" onclick="speak('${meaning.exampleSentenceTranslation.replace(/'/g, "\\'")}', 'ko-KR')">${createVolumeIcon('w-5 h-5')}<span class="tooltip">한국어 듣기</span></button><button class="icon-btn" onclick="saveSentence('${meaning.exampleSentence.replace(/'/g, "\\'")}', '${meaning.exampleSentenceTranslation.replace(/'/g, "\\'")}')">${createSaveIcon('w-5 h-5')}<span class="tooltip">저장하기</span></button></div></div><p class="font-medium mt-4 mb-2">추가 예문:</p><ul class="list-inside space-y-2">${examplesHtml}</ul>`;
    }
    safeCreateIcons();
}

window.renderSentenceCrafter = function(word, container) { const html = `<div class="card p-6"><h3 class="text-2xl font-bold mb-4 flex items-center"><i data-lucide="sparkles" class="mr-2 text-blue-500"></i>AI 문장 만들기 ✨</h3><p class="text-gray-600 mb-4">단어를 사용하고 싶은 상황을 입력하면 AI가 맞춤 예문을 만들어 드립니다. (예: 회의, 친구와의 대화, 이메일 작성)</p><div class="flex flex-col sm:flex-row gap-4"><input type="text" id="sentence-context-input" placeholder="상황을 입력하세요..." class="w-full px-4 py-3 text-lg border-2 border-slate-300 bg-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"><button id="sentence-craft-button" class="btn-3d w-full sm:w-auto" onclick="craftSentences(this, '${word}')"><i data-lucide="pencil-ruler" class="inline-block mr-2"></i> 생성</button></div><div id="sentence-crafter-results" class="mt-4"></div></div>`; container.insertAdjacentHTML('beforeend', html); safeCreateIcons(); }
window.renderDeepDive = function(data, container) { const html = `<div class="card p-6"><h3 class="text-2xl font-bold mb-4 flex items-center"><i data-lucide="graduation-cap" class="mr-2 text-purple-600"></i>심화 학습</h3><div class="space-y-6">${renderSection("관련 명언/문구", "quote", data.quotes.map(q => `<div class="border-l-4 border-slate-400 pl-4 py-2"><p class="font-semibold text-lg">${addClickToSearch(q.quote)}</p><p class="text-gray-600">${q.translation}</p><div class="mt-2 flex gap-2"><button class="icon-btn" onclick="speak('${q.quote.replace(/'/g, "\\'")}', 'en-US')">${createVolumeIcon('w-5 h-5')}<span class="tooltip">영어 듣기</span></button><button class="icon-btn" onclick="speak('${q.translation.replace(/'/g, "\\'")}', 'ko-KR')">${createVolumeIcon('w-5 h-5')}<span class="tooltip">한국어 듣기</span></button><button class="icon-btn" onclick="saveSentence('${q.quote.replace(/'/g, "\\'")}', '${q.translation.replace(/'/g, "\\'")}')">${createSaveIcon('w-5 h-5')}<span class="tooltip">저장하기</span></button></div></div>`).join('<hr class="my-3 border-slate-300">'))}${renderSection("유의어 및 반의어", "arrow-right-left", `<div><h5 class="font-semibold">유의어:</h5><div class="flex flex-wrap gap-2 mt-2">${data.synonyms.map(s => `<span class="bg-green-100 text-green-800 px-3 py-1 rounded-full clickable-word">${s}</span>`).join('')}</div></div><div class="mt-4"><h5 class="font-semibold">반의어:</h5><div class="flex flex-wrap gap-2 mt-2">${data.antonyms.map(a => `<span class="bg-red-100 text-red-800 px-3 py-1 rounded-full clickable-word">${a}</span>`).join('')}</div></div>`)}${renderSection("AI 시나리오 학습", "message-circle", `<div class="bg-slate-200 p-4 rounded-lg space-y-3">${data.dialogue.map(d => `<div class="border-b border-slate-300 pb-2 mb-2 last:border-b-0 last:pb-0 last:mb-0"><div class="flex justify-between items-start gap-2"><div class="flex-grow"><p><span class="font-bold text-blue-600">${d.speaker}:</span> ${addClickToSearch(d.line)}</p><p class="text-sm text-gray-500 pl-4">${d.translation}</p></div><div class="flex items-center flex-shrink-0 gap-1 mt-1"><button class="icon-btn" onclick="speak('${d.line.replace(/'/g, "\\'")}', 'en-US')">${createVolumeIcon('w-5 h-5')}<span class="tooltip">영어 듣기</span></button><button class="icon-btn" onclick="speak('${d.translation.replace(/'/g, "\\'")}', 'ko-KR')">${createVolumeIcon('w-5 h-5')}<span class="tooltip">한국어 듣기</span></button><button class="icon-btn" onclick="saveSentence('${d.line.replace(/'/g, "\\'")}', '${d.translation.replace(/'/g, "\\'")}')">${createSaveIcon('w-5 h-5')}<span class="tooltip">저장하기</span></button></div></div></div>`).join('')}</div>`)}${renderQuiz("4지선다 퀴즈", "swords", data.quiz)}</div></div>`; container.insertAdjacentHTML('beforeend', html); safeCreateIcons(); }
window.renderSection = function(title, icon, content) { return `<div class="border-t border-slate-300 pt-4"><h4 class="text-xl font-semibold mb-3 flex items-center"><i data-lucide="${icon}" class="w-5 h-5 mr-2"></i>${title}</h4><div>${content}</div></div>`; }
window.renderQuiz = function(title, icon, quizData) { const quizContent = quizData.map((q, index) => { const optionsHtml = q.options.map(option => `<label class="block"><input type="radio" name="quiz-${index}" value="${option}" class="mr-2">${option}</label>`).join(''); return `<div class="mt-4 bg-slate-200 p-4 rounded-lg" id="quiz-container-${index}"><p class="font-semibold">${index + 1}. ${q.question}</p><div class="my-2 space-y-1">${optionsHtml}</div><button onclick="checkQuizAnswer(this, ${index}, '${q.answer.replace(/'/g, "\\'")}')" class="text-sm bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 quiz-button">정답 확인</button><div id="quiz-explanation-${index}" class="hidden mt-2 p-2 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700"><p><strong class="font-bold">정답: ${q.answer}</strong></p><p>${q.explanation}</p></div></div>`; }).join(''); return renderSection(title, icon, quizContent); }

// ---------------------------
// UI/UX Utility Functions
// ---------------------------
function createVolumeIcon(size = 'w-5 h-5') { return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${size} text-blue-500"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`; }
function createSaveIcon(size = 'w-5 h-5') { return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${size} text-green-600"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`; }
window.checkQuizAnswer = function(button, index, correctAnswer) { const container = button.closest(`#quiz-container-${index}`); const selected = container.querySelector(`input[name="quiz-${index}"]:checked`); if (!selected) { showToast("답을 선택해주세요.", "warning"); return; } if (selected.value === correctAnswer) { selected.parentElement.classList.add('text-green-600', 'font-bold'); showToast("정답입니다!", "success"); } else { selected.parentElement.classList.add('text-red-600', 'font-bold'); showToast("오답입니다. 다시 생각해보세요.", "error"); } container.querySelector(`#quiz-explanation-${index}`).classList.remove('hidden'); }
function showLoader(progress, text) { loadingContainer.classList.remove('hidden'); progressBar.style.width = `${progress}%`; loadingText.textContent = text; }
function updateLoader(progress, text) { progressBar.style.width = `${progress}%`; loadingText.textContent = text; }
function hideLoader() { loadingContainer.classList.add('hidden'); }
function addClickToSearch(text) { if(!text) return ''; return text.replace(/\b[a-zA-Z]{2,}\b/g, (match) => `<span class="clickable-word">${match}</span>`); }
window.speak = function(text, lang = 'en-US') { if (!('speechSynthesis' in window)) { showToast("현재 브라우저에서는 음성 출력을 지원하지 않습니다.", "warning"); return; } if (!text) return; speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = lang; speechSynthesis.speak(utterance); }
window.startPronunciationCheck = function(word) { const feedbackDiv = document.getElementById('pronunciation-feedback'); feedbackDiv.classList.add('hidden'); const message = `🎤 "${word}" 발음 녹음을 준비합니다. (실제 기능에서는 Gemini TTS API를 사용합니다.)`; showToast(message, 'info'); setTimeout(async () => { const prompt = `Act as an English teacher. Evaluate the pronunciation of the word "${word}" based on a typical non-native Korean speaker attempting to say it. Give encouraging but specific feedback. Format as a short paragraph in Korean.`; try { const feedbackText = await callGemini(prompt); feedbackDiv.innerHTML = `<i data-lucide="mic-vocal" class="inline-block mr-2 text-purple-600"></i><strong class="text-purple-700">AI 발음 피드백:</strong> ${feedbackText}`; feedbackDiv.classList.remove('hidden'); safeCreateIcons(); } catch (e) { feedbackDiv.innerHTML = `<i data-lucide="x-circle" class="inline-block mr-2 text-red-600"></i><strong class="text-red-700">AI 발음 피드백:</strong> 피드백 생성에 실패했습니다.`; feedbackDiv.classList.remove('hidden'); safeCreateIcons(); } }, 5000); }

// ---------------------------
// Modal and Tooltip Functions
// ---------------------------

window.showImageAnalysisModal = async function(src, word, meaning) { 
    modalContent.innerHTML = `<div class="flex justify-between items-center mb-4"><h3 class="text-2xl font-bold">이미지 분석: ${word}</h3><button onclick="hideModal()" class="text-gray-500 hover:text-gray-800"><i data-lucide="x"></i></button></div><img src="${src}" alt="${word}" class="rounded-lg shadow-md w-full h-auto object-cover mb-6"><div id="image-analysis-result" class="p-4 bg-slate-200 rounded-lg"><p class="font-semibold text-gray-700 flex items-center"><div class="loader w-4 h-4 border-2 border-t-blue-500 inline-block mr-2 animate-spin"></div>AI가 이미지를 분석 중입니다...</p></div>`; 
    modalContainer.classList.remove('hidden'); 
    modalContainer.classList.add('flex'); 
    safeCreateIcons(); 
    
    const activeTab = tabs[activeTabId];
    const savedAnalysisText = activeTab?.fullSearchResult?.mainImageAnalysisText;

    if (savedAnalysisText) {
        document.getElementById('image-analysis-result').innerHTML = `<strong class="text-blue-700">AI 분석 (저장됨):</strong> ${savedAnalysisText}`;
        return; 
    }

    let base64Image = null;
    try {
        if (src.startsWith('data:image')) {
            base64Image = src.split(',')[1];
        } else {
            const proxyResponse = await fetch('/api/fetchImage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageUrl: src })
            });
            
            if (!proxyResponse.ok) {
                const errorData = await proxyResponse.json();
                throw new Error(`Proxy failed: ${errorData.error || 'Unknown error'}`);
            }
            
            const imageData = await proxyResponse.json();
            base64Image = imageData.base64;
        }
        
        if (base64Image) {
            const prompt = `Analyze this image which was generated to represent the word "${word}" (meaning: ${meaning}). Describe how the visual elements in the image conceptually represent the word. Respond in Korean.`;
            
            callGemini(prompt, false, base64Image).then(analysis => { 
                document.getElementById('image-analysis-result').innerHTML = `<strong class="text-blue-700">AI 분석:</strong> ${analysis}`;
                if (activeTab?.fullSearchResult) {
                    activeTab.fullSearchResult.mainImageAnalysisText = analysis;
                }

            }).catch(e => { 
                console.error("Gemini analysis failed:", e);
                document.getElementById('image-analysis-result').innerHTML = `<strong class="text-red-600">분석 실패:</strong> AI가 이미지를 분석할 수 없습니다. (Gemini 오류)`; 
            });
        } else {
            throw new Error("Failed to get base64 data from source");
        }
    } catch (error) {
        console.error("Image analysis prep failed:", error);
        document.getElementById('image-analysis-result').innerHTML = `<strong class="text-red-600">분석 실패:</strong> 이미지 소스를 처리할 수 없습니다. (${error.message})`;
    }
}


window.showImageModal = function(src) { modalImage.src = src; imageModalContainer.classList.remove('hidden'); imageModalContainer.classList.add('flex'); safeCreateIcons(); }
window.hideImageModal = function() { imageModalContainer.classList.add('hidden'); imageModalContainer.classList.remove('flex'); modalImage.src = ''; }
function renderEncyclopediaSection(title, content_en, content_ko) { const safe_content_en = content_en || ''; const safe_content_ko = content_ko || ''; if (!safe_content_en && !safe_content_ko) return ''; return `<div class="mt-6"><h4 class="text-xl font-bold mb-2">${title}</h4><div class="prose max-w-none text-justify space-y-4"><p class="text-gray-700">${safe_content_ko.replace(/\n/g, '<br>')}</p><details class="text-sm"><summary class="cursor-pointer text-gray-500">영어 원문 보기</summary><p class="mt-2 text-gray-600">${addClickToSearch(safe_content_en.replace(/\n/g, '<br>'))}</p></details></div></div>`; }
function getEncyclopediaHtml(data) { return `<div class="print-section"><h3 class="text-2xl font-bold mb-4">백과사전식 심화 설명</h3>${renderEncyclopediaSection('서론 (Introduction)', data.introduction, data.introduction_ko)}${renderEncyclopediaSection('어원 (Etymology)', data.etymology, data.etymology_ko)}${renderEncyclopediaSection('역사적 배경 (Historical Background)', data.history, data.history_ko)}${renderEncyclopediaSection('문학/현대에서의 사용 (Usage)', data.usage, data.usage_ko)}</div>`; }
function showEncyclopedia(data) { modalContent.innerHTML = `<div class="flex justify-between items-center mb-4"><h3 class="text-2xl font-bold">백과사전식 설명</h3><button onclick="hideModal()" class="text-gray-500 hover:text-gray-800"><i data-lucide="x"></i></button></div><div id="encyclopedia-content">${renderEncyclopediaSection('서론 (Introduction)', data.introduction, data.introduction_ko)}${renderEncyclopediaSection('어원 (Etymology)', data.etymology, data.etymology_ko)}${renderEncyclopediaSection('역사적 배경 (Historical Background)', data.history, data.history_ko)}${renderEncyclopediaSection('문학/현대에서의 사용 (Usage)', data.usage, data.usage_ko)}</div>`; modalContainer.classList.remove('hidden'); modalContainer.classList.add('flex'); safeCreateIcons(); }
function getConceptTreeHtml(data) { const createList = (title, items) => { if (!items || items.length === 0) return ''; const itemsHtml = items.map(item => `<span class="bg-gray-100 text-gray-800 px-3 py-1 rounded-full">${item}</span>`).join(''); return `<div><h4 class="font-semibold text-lg mt-4">${title}</h4><div class="flex flex-wrap gap-2 mt-2">${itemsHtml}</div></div>` }; return `<div class="print-section mt-8"><h3 class="text-2xl font-bold mb-4">개념 트리</h3>${createList('상위 개념', data.superordinate)}${createList('동위 개념', data.coordinate)}${createList('하위 개념', data.subordinate)}</div>`; }
function showConceptTree(data) { const createList = (title, items) => { if (!items || items.length === 0) return ''; return `<div><h4 class="font-semibold text-lg mt-4">${title}</h4><div class="flex flex-wrap gap-2 mt-2">${items.map(item => `<span class="bg-blue-100 text-blue-800 px-3 py-1 rounded-full clickable-word">${item}</span>`).join('')}</div></div>` }; modalContent.innerHTML = `<div class="flex justify-between items-center mb-4"><h3 class="text-2xl font-bold">개념 트리</h3><button onclick="hideModal()" class="text-gray-500 hover:text-gray-800"><i data-lucide="x"></i></button></div><div id="concept-tree-content">${createList('상위 개념', data.superordinate)}${createList('동위 개념', data.coordinate)}${createList('하위 개념', data.subordinate)}</div>`; modalContainer.classList.remove('hidden'); modalContainer.classList.add('flex'); safeCreateIcons(); }
window.hideModal = function(event) { if (event && event.currentTarget !== event.target) return; modalContainer.classList.add('hidden'); modalContainer.classList.remove('flex'); }
window.showFileModal = function() { fileModalContainer.classList.remove('hidden'); fileModalContainer.classList.add('flex'); }
window.hideFileModal = function(event) { if (event && event.currentTarget !== event.target && !event.target.closest('button')) return; fileModalContainer.classList.add('hidden'); fileModalContainer.classList.remove('flex'); }
function showConfirmationModal(message, onConfirm) { confirmationMessage.textContent = message; confirmCallback = onConfirm; confirmationModal.classList.remove('hidden'); confirmationModal.classList.add('flex'); }
function hideConfirmationModal() { confirmationModal.classList.add('hidden'); confirmationModal.classList.remove('flex'); confirmCallback = null; }

// 6. Firestore Data Management
window.saveCurrentPage = async function(tabId) {
    const tab = tabs[tabId];
    if (!tab || !tab.fullSearchResult) {
        showToast("저장할 데이터가 없습니다.", "error");
        return;
    }
    const saveButton = document.getElementById(`save-page-btn-${tabId}`);
    saveButton.disabled = true;
    saveButton.innerHTML = `<div class="loader w-5 h-5 border-2 border-t-blue-500 inline-block mr-2 animate-spin"></div>0%...`;

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

        if (pageData.mainImageUrl && pageData.mainImageUrl.startsWith('data:image')) {
            imageUploads.push(
                uploadBase64Image(pageData.mainImageUrl, `saved_pages/${userId}/${word}/main.png`)
                    .then(url => pageData.mainImageUrl = url)
            );
        }
        if (pageData.episodeImageUrl && pageData.episodeImageUrl.startsWith('data:image')) {
            imageUploads.push(
                uploadBase64Image(pageData.episodeImageUrl, `saved_pages/${userId}/${word}/episode.png`)
                    .then(url => pageData.episodeImageUrl = url)
            );
        }
        if (pageData.meaningsData) {
            pageData.meaningsData.forEach((meaning, index) => {
                if (meaning.imageUrl && meaning.imageUrl.startsWith('data:image')) {
                    imageUploads.push(
                        uploadBase64Image(meaning.imageUrl, `saved_pages/${userId}/${word}/meaning_${index}.png`)
                            .then(url => pageData.meaningsData[index].imageUrl = url)
                    );
                }
            });
        }

        if (imageUploads.length === 0) {
             saveButton.innerHTML = `<div class="loader w-5 h-5 border-2 border-t-blue-500 inline-block mr-2 animate-spin"></div>Firestore 저장 중...`;
        }

        let completedUploads = 0;
        imageUploads.forEach(promise => {
            promise.then(() => {
                completedUploads++;
                const progress = Math.round((completedUploads / imageUploads.length) * 100);
                saveButton.innerHTML = `<div class="loader w-5 h-5 border-2 border-t-blue-500 inline-block mr-2 animate-spin"></div>${progress}%...`;
            }).catch(err => {
                console.error("Image upload failed in promise:", err);
            });
        });

        await Promise.all(imageUploads.map(p => p.catch(e => e))); 

        saveButton.innerHTML = `<div class="loader w-5 h-5 border-2 border-t-blue-500 inline-block mr-2 animate-spin"></div>Firestore 저장 중...`;
        const pageRef = doc(db, `artifacts/${appId}/users/${userId}/saved_pages/${word}`);
        await setDoc(pageRef, {
            word: word,
            savedAt: new Date(),
            pageData: pageData 
        });

        showToast("페이지가 성공적으로 저장되었습니다!", "success");
        renderDeletePageButton(tab.contentEl, word, `save-page-btn-${tabId}`);
    } catch (error) {
        console.error("Error saving page:", error);
        showToast("페이지 저장에 실패했습니다.", "error");
        saveButton.disabled = false;
        saveButton.innerHTML = `💾 이 페이지 저장하기`;
    }
}

window.deleteSavedPage = async function(word) {
    const normalizedWord = word.toLowerCase();
    showConfirmationModal(`'${normalizedWord}'의 저장된 페이지를 정말로 삭제하시겠습니까? (저장된 이미지 파일은 삭제되지 않습니다)`, async () => {
        if (!db || !userId) {
            showToast("DB 연결 오류", "error");
            return;
        }
        const pageRef = doc(db, `artifacts/${appId}/users/${userId}/saved_pages/${normalizedWord}`);
        try {
            await deleteDoc(pageRef);
            showToast("저장된 페이지를 삭제했습니다.", "success");
            
            const deleteButton = document.getElementById(`delete-page-btn-${normalizedWord}`);
            if(deleteButton) {
                const tabId = deleteButton.closest('[id^="tab-content-"]').id.replace('tab-content-', 'tab-');
                const saveButton = document.createElement('button');
                saveButton.id = `save-page-btn-${tabId}`;
                saveButton.className = 'btn-3d mb-4 ml-4';
                saveButton.disabled = false; 
                saveButton.innerHTML = `💾 이 페이지 저장하기`;
                saveButton.onclick = () => saveCurrentPage(tabId);
                deleteButton.replaceWith(saveButton);
                safeCreateIcons();
            }
        } catch (error) {
            console.error("Error deleting saved page:", error);
            showToast("삭제에 실패했습니다.", "error");
        }
    });
}

async function addWordToHistory(word, meaning) { 
    if (!db || !userId) return; 
    const normalizedWord = word.toLowerCase();
    const wordRef = doc(db, `artifacts/${appId}/users/${userId}/saved_words/${normalizedWord}`); 
    try { 
        await setDoc(wordRef, { word: normalizedWord, meaning, timestamp: new Date(), read: false }, { merge: true }); 
    } catch(e){ console.error("Error adding word to history: ", e); } 
}
window.saveSentence = async function(en, ko) { if (!db || !userId) { showToast("데이터베이스에 연결되지 않았습니다.", "error"); return; } try { const sentenceRef = collection(db, `artifacts/${appId}/users/${userId}/saved_sentences`); await addDoc(sentenceRef, { en, ko, timestamp: new Date(), read: false }); showToast("예문이 저장되었습니다.", "success"); } catch (e) { console.error("Error saving sentence: ", e); showToast("예문 저장에 실패했습니다.", "error"); } }

// 7. Saved List Modal UI
let currentListType = ''; let currentSort = 'newest';
function showListModal(type) { currentListType = type; listModalContainer.classList.remove('hidden'); listModalContainer.classList.add('flex'); if (type === 'words') { listModalTitle.textContent = '단어 목록 (검색 기록)'; sortOptions.innerHTML = `<option value="newest">최신순</option><option value="alphabetical">알파벳순</option>`; } else { listModalTitle.textContent = '저장된 예문 목록'; sortOptions.innerHTML = `<option value="newest">최신순</option><option value="length">길이순</option>`; } sortOptions.value = currentSort; renderList(); updateListActionButtonsState(); }

function renderList() { 
    let items = currentListType === 'words' ? [...savedWords] : [...savedSentences]; 
    items.sort((a, b) => { 
        if (!a.timestamp || !b.timestamp) return 0; 
        const timeA = a.timestamp.toMillis ? a.timestamp.toMillis() : new Date(a.timestamp).getTime(); 
        const timeB = b.timestamp.toMillis ? b.timestamp.toMillis() : new Date(b.timestamp).getTime(); 
        return timeB - timeA; 
    }); 
    
    if (currentSort === 'alphabetical' && currentListType === 'words') { 
        items.sort((a, b) => a.word.localeCompare(b.word)); 
    } else if (currentSort === 'length' && currentListType === 'sentences') { 
        items.sort((a, b) => a.en.length - b.en.length); 
    } 
    
    if (items.length === 0) { 
        listModalContent.innerHTML = `<p class="text-center text-gray-500">저장된 항목이 없습니다.</p>`; 
        return; 
    } 
    
    listModalContent.innerHTML = items.map(item => { 
        const readClass = item.read ? 'opacity-50' : ''; 
        
        const baseHtml = `<div class="flex items-center justify-between p-3 rounded-lg hover:bg-slate-200 ${readClass}" data-id="${item.id}"><div class="flex items-center flex-grow"><input type="checkbox" class="mr-4 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 item-checkbox" data-id="${item.id}"><div class="flex-grow">`; 
        
        if (currentListType === 'words') { 
            return baseHtml + `<p class="font-bold text-lg" data-word="${item.word}">${item.word}</p><p class="truncate">${item.meaning}</p></div></div>
                <div class="flex items-center gap-1 flex-shrink-0">
                    <button onclick="loadWordFromList('${item.word.replace(/'/g, "\\'")}', true)" class="icon-btn">${createLoadIcon()}<span class="tooltip">저장된 페이지 로드</span></button>
                    <button onclick="loadWordFromList('${item.word.replace(/'/g, "\\'")}', false)" class="icon-btn">${createSearchIcon()}<span class="tooltip">새로 검색</span></button>
                    <button onclick="toggleReadStatus('${item.id}', 'words')" class="icon-btn">${item.read ? createEyeOffIcon() : createEyeIcon()} <span class="tooltip">${item.read ? '읽지 않음으로' : '읽음으로'}</span></button>
                    <button onclick="deleteListItem('${item.id}', 'words')" class="icon-btn text-red-500 hover:bg-red-100">${createTrashIcon()}<span class="tooltip">삭제</span></button>
                </div></div>`; 
        } else { 
            return baseHtml + `<div><p class="font-semibold">${addClickToSearch(item.en)}</p><p class="text-sm">${item.ko}</p></div></div></div><div class="flex items-center gap-1 flex-shrink-0"><button class="icon-btn" onclick="speak('${item.en.replace(/'/g, "\\'")}', 'en-US')">${createVolumeIcon('w-5 h-5')}<span class="tooltip">영어 듣기</span></button><button onclick="toggleReadStatus('${item.id}', 'sentences')" class="icon-btn">${item.read ? createEyeOffIcon() : createEyeIcon()}<span class="tooltip">${item.read ? '읽지 않음으로' : '읽음으로'}</span></button><button onclick="deleteListItem('${item.id}', 'sentences')" class="icon-btn text-red-500 hover:bg-red-100">${createTrashIcon()}<span class="tooltip">삭제</span></button></div></div>`; 
        } 
    }).join('<hr class="my-1 border-slate-300">'); 
    
    safeCreateIcons(); 
} 
window.renderList = renderList;


function createEyeIcon(size = 'w-5 h-5') { return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${size} text-gray-500"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>`; } function createEyeOffIcon(size = 'w-5 h-5') { return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${size} text-gray-500"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"></path><path d="M6.61 6.61A13.16 13.16 0 0 0 2 12s3 7 10 7a9.92 9.92 0 0 0 5.43-1.61"></path><line x1="2" x2="22" y1="2" y2="22"></line></svg>`; } function createTrashIcon(size = 'w-5 h-5') { return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${size} text-red-500"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M15 6V4c0-1-1-2-2-2h-2c-1 0-2 1-2 2v2"></path></svg>`; }
function createLoadIcon(size = 'w-5 h-5') { 
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${size} text-blue-600"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line></svg>`; 
}
function createSearchIcon(size = 'w-5 h-5') { 
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${size} text-green-600"><circle cx="11" cy="11" r="8"></circle><line x1="21" x2="16.65" y1="21" y2="16.65"></line></svg>`; 
}
window.loadWordFromList = function(word, fromSaved) {
    searchInput.value = word;
    if (fromSaved) {
        checkAndLoadPage(word); 
    } else {
        executeSearchForWord(word);
    }
    hideListModal(); 
}

window.deleteListItem = function(id, type) { 
    const normalizedId = type === 'words' ? id.toLowerCase() : id;
    showConfirmationModal("정말로 이 항목을 삭제하시겠습니까?", async () => { 
        if (!db || !userId) return; 
        const collectionName = type === 'words' ? 'saved_words' : 'saved_sentences'; 
        const docRef = doc(db, `artifacts/${appId}/users/${userId}/${collectionName}/${normalizedId}`); 
        try { 
            await deleteDoc(docRef); 
            showToast("삭제되었습니다.", "success"); 
        } catch (error) { 
            console.error("Error deleting item:", error); 
            showToast("삭제에 실패했습니다.", "error"); 
        } 
    }); 
}
window.toggleReadStatus = async function(id, type) { 
    if (!db || !userId) return; 
    const normalizedId = type === 'words' ? id.toLowerCase() : id;
    const collectionName = type === 'words' ? 'saved_words' : 'saved_sentences'; 
    const docRef = doc(db, `artifacts/${appId}/users/${userId}/${collectionName}/${normalizedId}`); 
    try { 
        const docSnap = await getDoc(docRef); 
        if (docSnap.exists()) { 
            const currentStatus = docSnap.data().read; 
            await updateDoc(docRef, { read: !currentStatus }); 
        } 
    } catch (error) { 
        console.error("Error toggling read status:", error); 
        showToast("상태 변경에 실패했습니다.", "error"); 
    } 
};
function updateListActionButtonsState() { const checkedItems = listModalContent.querySelectorAll('.item-checkbox:checked'); const hasSelection = checkedItems.length > 0; markReadBtn.disabled = !hasSelection; markUnreadBtn.disabled = !hasSelection; deleteSelectedBtn.disabled = !hasSelection; }
async function performBulkAction(action) { const checkedItems = listModalContent.querySelectorAll('.item-checkbox:checked'); if (checkedItems.length === 0) { showToast("항목을 선택해주세요.", "warning"); return; } const actionText = action === 'delete' ? '삭제' : '상태 변경'; showConfirmationModal(`선택한 ${checkedItems.length}개 항목을 정말로 ${actionText}하시겠습니까?`, async () => { if (!db || !userId) return; const batch = writeBatch(db); const collectionName = currentListType === 'words' ? 'saved_words' : 'saved_sentences'; checkedItems.forEach(item => { 
    const normalizedId = currentListType === 'words' ? item.dataset.id.toLowerCase() : item.dataset.id;
    const docRef = doc(db, `artifacts/${appId}/users/${userId}/${collectionName}/${normalizedId}`); 
    if (action === 'delete') { batch.delete(docRef); } else { batch.update(docRef, { read: action === 'mark-read' }); } }); try { await batch.commit(); showToast("선택한 항목들이 처리되었습니다.", "success"); } catch (error) { console.error("Bulk action failed:", error); showToast("작업에 실패했습니다.", "error"); } }); }
window.hideListModal = function(event) { if(event) { if (event.currentTarget !== event.target && !event.target.closest('button')) return; } listModalContainer.classList.add('hidden'); listModalContainer.classList.remove('flex'); }

// 8. Tab & Print Management (No changes needed)
function addTab(query, makeActive = true) { const tabId = `tab-${++tabCounter}`; const tabBar = document.getElementById('tab-bar'); const tabContentContainer = document.getElementById('tab-content-container'); const tabButton = document.createElement('button'); tabButton.id = `tab-btn-${tabId}`; tabButton.className = 'px-4 py-2 -mb-px border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-400 flex items-center'; tabButton.dataset.tabId = tabId; tabButton.innerHTML = `<span class="tab-title">${query.length > 10 ? query.substring(0, 10) + '...' : query}</span><span class="close-tab-btn ml-2 hover:bg-red-200 rounded-full w-4 h-4 flex items-center justify-center text-xs font-bold">&times;</span>`; tabBar.appendChild(tabButton); const tabContent = document.createElement('div'); tabContent.id = `tab-content-${tabId}`; tabContent.className = 'space-y-8'; tabContentContainer.appendChild(tabContent); tabs[tabId] = { id: tabId, query, contentEl: tabContent, buttonEl: tabButton, searchId: 0, fullSearchResult: null, imageLoadPromises: [] }; tabButton.addEventListener('click', () => switchTab(tabId)); tabButton.querySelector('.close-tab-btn').addEventListener('click', (e) => { e.stopPropagation(); closeTab(tabId); }); if (makeActive) { switchTab(tabId); } return tabId; }
function switchTab(tabId) { if (!tabs[tabId]) return; activeTabId = tabId; for (const id in tabs) { tabs[id].buttonEl.classList.remove('border-blue-500', 'text-gray-900', 'font-semibold'); tabs[id].buttonEl.classList.add('border-transparent', 'text-gray-500'); tabs[id].contentEl.classList.add('hidden'); } tabs[tabId].buttonEl.classList.add('border-blue-500', 'text-gray-900', 'font-semibold'); tabs[tabId].buttonEl.classList.remove('border-transparent', 'text-gray-500'); tabs[tabId].contentEl.classList.remove('hidden'); }
function closeTab(tabId) { if (!tabs[tabId]) return; tabs[tabId].buttonEl.remove(); tabs[tabId].contentEl.remove(); delete tabs[tabId]; if (activeTabId === tabId) { const remainingTabIds = Object.keys(tabs); if (remainingTabIds.length > 0) { switchTab(remainingTabIds[remainingTabIds.length - 1]); } else { activeTabId = null; } } }
function handlePrint(tabId) { const tab = tabs[tabId]; if (!tab || !tab.fullSearchResult || !tab.fullSearchResult.encyclopediaData || !tab.fullSearchResult.fastDeepDiveData) { showToast("인쇄 데이터가 아직 준비되지 않았습니다. 모든 정보가 로딩될 때까지 기다려주세요.", "warning"); return; } const mainContentHtml = tab.contentEl.innerHTML; const encyclopediaHtml = getEncyclopediaHtml(tab.fullSearchResult.encyclopediaData.encyclopedia); const conceptTreeHtml = getConceptTreeHtml(tab.fullSearchResult.fastDeepDiveData.conceptTree); printContentArea.innerHTML = mainContentHtml + encyclopediaHtml + conceptTreeHtml; printContainer.style.display = 'block'; if (window.lucide) { printContainer.querySelectorAll('[data-lucide]').forEach(el => el.remove()); window.lucide.createIcons({ attr: 'data-lucide', element: printContainer }); } window.print(); setTimeout(() => { printContainer.style.display = 'none'; printContentArea.innerHTML = ''; }, 500); }

// 9. File Storage (No changes needed)

function createDownloadIcon(size = 'w-5 h-5') { return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${size} text-blue-600"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line></svg>`; }
window.downloadFile = function(fullPath) { getDownloadURL(ref(storage, fullPath)).then((url) => { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.click(); }).catch((error) => { console.error("Error getting download URL:", error); showToast("파일 다운로드 실패.", "error"); }); }
window.deleteFile = function(docId, fullPath) { showConfirmationModal("정말로 이 파일을 삭제하시겠습니까?", async () => { const fileRef = ref(storage, fullPath); const docRef = doc(db, `artifacts/${appId}/users/${userId}/file_metadata/${docId}`); try { await deleteObject(fileRef); await deleteDoc(docRef); showToast("파일 삭제 성공.", "success"); } catch (error) { console.error("Error deleting file:", error); if (error.code === 'storage/object-not-found') { try { await deleteDoc(docRef); showToast("파일 정보 정리됨.", "info"); } catch (dbError) { console.error("Orphaned metadata delete error:", dbError); showToast("파일 삭제 실패.", "error"); } } else { showToast("파일 삭제 실패.", "error"); } } }); }

// 10. Advanced AI Interactions (No changes needed)
window.expandStory = async function(button, word, story, story_ko) { button.disabled = true; button.innerHTML = `<div class="loader w-5 h-5 border-2 border-t-blue-500 inline-block animate-spin"></div>`; try { const prompt = `You are a creative storyteller. Expand the following short, humorous story about the word "${word}" into a more detailed and engaging narrative of 3-4 paragraphs. Keep the funny and lighthearted tone.\n\nOriginal Story (English): "${story}"\nOriginal Story (Korean): "${story_ko}"\n\nPlease provide the expanded story in both English and Korean. Format your response as a JSON object with "expanded_story_en" and "expanded_story_ko" keys.`; const result = await callGemini(prompt, true); const episodeCard = button.closest('.card'); const storyContainer = episodeCard.querySelector('.space-y-2'); storyContainer.innerHTML = `<p class="text-lg leading-relaxed">${addClickToSearch(result.expanded_story_en)}</p><p class="text-md leading-relaxed text-gray-600 mt-2">${result.expanded_story_ko}</p>`; button.remove(); } catch (error) { console.error("Failed to expand story:", error); showToast("스토리 확장 실패.", "error"); button.disabled = false; button.innerHTML = `✨ 이야기 더 만들기`; } }
window.craftSentences = async function(button, word) { const contextInput = button.parentElement.querySelector('#sentence-context-input'); const context = contextInput.value.trim(); if (!context) { showToast("상황을 입력해주세요.", "warning"); return; } const resultsContainer = button.parentElement.parentElement.querySelector('#sentence-crafter-results'); resultsContainer.innerHTML = `<div class="loader mx-auto"></div>`; button.disabled = true; try { const prompt = `Create 3 example English sentences using the word "${word}" in the context of "${context}". For each sentence, provide a Korean translation. Return the result as a JSON array like this: [{"en": "Sentence 1.", "ko": "번역 1."}, {"en": "Sentence 2.", "ko": "번역 2."}]`; const sentences = await callGemini(prompt, true); const sentencesHtml = sentences.map((s, i) => `<li class="flex items-start justify-between gap-3 mt-2"><div class="flex items-start"><span class="text-gray-500 mr-2">${i + 1}.</span><div><p class="text-md font-medium">${addClickToSearch(s.en)}</p><p class="text-sm text-gray-500">${s.ko}</p></div></div><div class="flex items-center flex-shrink-0 gap-1"><button class="icon-btn" onclick="speak('${s.en.replace(/'/g, "\\'")}', 'en-US')">${createVolumeIcon('w-5 h-5')}<span class="tooltip">영어 듣기</span></button><button class="icon-btn" onclick="speak('${s.ko.replace(/'/g, "\\'")}', 'ko-KR')">${createVolumeIcon('w-5 h-5')}<span class="tooltip">한국어 듣기</span></button><button class="icon-btn" onclick="saveSentence('${s.en.replace(/'/g, "\\'")}', '${s.ko.replace(/'/g, "\\'")}')">${createSaveIcon('w-5 h-5')}<span class="tooltip">저장하기</span></button></div></li>`).join(''); resultsContainer.innerHTML = `<ul class="list-inside space-y-2">${sentencesHtml}</ul>`; safeCreateIcons(); } catch(error) { console.error("Failed to craft sentences:", error); resultsContainer.innerHTML = `<p class="text-red-500">문장 생성 실패.</p>`; showToast("문장 생성 실패.", "error"); } finally { button.disabled = false; } }

// 11. Initializers and Event Listeners
async function translateWordOnHover(word) {if (translationCache[word]) { return translationCache[word]; } try { const prompt = `Translate the English word "${word}" to Korean. Provide only the most common meaning.`; const translation = await callGemini(prompt); translationCache[word] = translation.trim(); return translationCache[word]; } catch (error) { console.error("Translation on hover failed:", error); return "번역 실패"; } }

document.addEventListener('DOMContentLoaded', initializeFirebase);
