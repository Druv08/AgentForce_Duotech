// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', async () => {
    // Firebase initialization and authentication
    const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

    let userId = null;
    let userName = '';
    let isAuthReady = false;

    // Function to handle sign-in
    async function handleSignIn() {
        try {
            if (initialAuthToken) {
                await signInWithCustomToken(auth, initialAuthToken);
            } else {
                await signInAnonymously(auth);
            }
        } catch (error) {
            console.error("Error signing in:", error);
        }
    }

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            userId = user.uid;
            isAuthReady = true;

            const userDocRef = doc(db, 'artifacts', appId, 'users', userId, 'user_details', 'profile');
            try {
                const userDoc = await getDoc(userDocRef);
                if (userDoc.exists()) {
                    const data = userDoc.data();
                    userName = data.name;
                    welcomeMessage.textContent = `Welcome back, ${userName}!`;
                    loginSection.style.display = 'none';
                    appSection.style.display = 'block';
                } else {
                    loginSection.style.display = 'block';
                }
            } catch (error) {
                console.error("Error fetching user data:", error);
                loginSection.style.display = 'block';
            }
        } else {
            isAuthReady = true;
            loginSection.style.display = 'block';
        }
    });

    // DOM elements
    const loginSection = document.getElementById('login-section');
    const appSection = document.getElementById('app-section');
    const loginForm = document.getElementById('login-form');
    const welcomeMessage = document.getElementById('welcome-message');
    const userQueryTextarea = document.getElementById('user-query');
    const submitQueryButton = document.getElementById('submit-query');
    const readResponseButton = document.getElementById('read-response');
    const getStructuredResponseButton = document.getElementById('get-structured-response');
    const responseContent = document.getElementById('response-content');
    const loadingIndicator = document.getElementById('loading-indicator');
    const loadingText = document.getElementById('loading-text');
    const errorMessage = document.getElementById('error-message');
    const logoutButton = document.getElementById('logout-button');

    // Initial sign-in call
    handleSignIn();

    // Helper function for exponential backoff retry logic
    const fetchWithRetry = async (url, options, retries = 3, delay = 1000) => {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch(url, options);
                if (response.status === 429) {
                    console.warn(`API request throttled. Retrying in ${delay}ms...`);
                    await new Promise(res => setTimeout(res, delay));
                    delay *= 2;
                    continue;
                }
                if (!response.ok) {
                    const errorBody = await response.text();
                    throw new Error(`API error: ${response.status} ${response.statusText} - ${errorBody}`);
                }
                return response;
            } catch (error) {
                if (i === retries - 1) throw error;
            }
        }
        throw new Error('All API retries failed.');
    };
    
    // Helper function to decode base64 to ArrayBuffer
    const base64ToArrayBuffer = (base64) => {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    };

    // Helper function to convert raw PCM audio to a WAV file Blob
    const pcmToWav = (pcmData, sampleRate) => {
        const dataLength = pcmData.length * 2; // PCM 16-bit
        const buffer = new ArrayBuffer(44 + dataLength);
        const view = new DataView(buffer);
        let offset = 0;

        // RIFF chunk descriptor
        writeString(view, offset, 'RIFF'); offset += 4;
        view.setUint32(offset, 36 + dataLength, true); offset += 4;
        writeString(view, offset, 'WAVE'); offset += 4;
        
        // FMT sub-chunk
        writeString(view, offset, 'fmt '); offset += 4;
        view.setUint32(offset, 16, true); offset += 4; // Sub-chunk size
        view.setUint16(offset, 1, true); offset += 2; // Audio format (1 = PCM)
        view.setUint16(offset, 1, true); offset += 2; // Number of channels
        view.setUint32(offset, sampleRate, true); offset += 4; // Sample rate
        view.setUint32(offset, sampleRate * 2, true); offset += 4; // Byte rate
        view.setUint16(offset, 2, true); offset += 2; // Block align
        view.setUint16(offset, 16, true); offset += 2; // Bits per sample

        // data sub-chunk
        writeString(view, offset, 'data'); offset += 4;
        view.setUint32(offset, dataLength, true); offset += 4;
        
        // Write PCM data
        for (let i = 0; i < pcmData.length; i++) {
            view.setInt16(offset, pcmData[i], true);
            offset += 2;
        }

        return new Blob([view], { type: 'audio/wav' });
    };

    const writeString = (view, offset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };

    // Handle login form submission
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newUserName = document.getElementById('user-name').value;
        const userEmail = document.getElementById('user-email').value;

        if (newUserName && userEmail && isAuthReady) {
            userName = newUserName;
            const userDocRef = doc(db, 'artifacts', appId, 'users', userId, 'user_details', 'profile');
            try {
                await setDoc(userDocRef, {
                    name: userName,
                    email: userEmail
                });
                welcomeMessage.textContent = `Hello, ${userName}!`;
                loginSection.style.display = 'none';
                appSection.style.display = 'block';
            } catch (error) {
                console.error("Error saving user data:", error);
            }
        }
    });
    
    // Handle standard AI query submission
    submitQueryButton.addEventListener('click', async () => {
        const userQuery = userQueryTextarea.value.trim();
        if (userQuery === '' || !isAuthReady) return;

        responseContent.textContent = '';
        loadingText.textContent = 'AI is thinking...';
        loadingIndicator.style.display = 'flex';
        errorMessage.style.display = 'none';

        const prompt = `You are a helpful and creative AI marketing assistant. The user's name is ${userName}.
            User Query: ${userQuery}`;

        let chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
        const payload = { contents: chatHistory };
        const apiKey = "";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

        try {
            const response = await fetchWithRetry(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
                responseContent.textContent = result.candidates[0].content.parts[0].text;
            } else {
                responseContent.textContent = 'Sorry, I could not generate a response. Please try again.';
            }
        } catch (error) {
            console.error('API call failed:', error);
            errorMessage.style.display = 'block';
        } finally {
            loadingIndicator.style.display = 'none';
        }
    });
    
    // Handle Text-to-Speech (TTS)
    readResponseButton.addEventListener('click', async () => {
        const textToSpeak = responseContent.textContent.trim();
        if (textToSpeak === '') return;

        loadingText.textContent = 'Generating speech...';
        loadingIndicator.style.display = 'flex';
        
        const payload = {
            contents: [{ parts: [{ text: textToSpeak }] }],
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } }
                }
            },
            model: "gemini-2.5-flash-preview-tts"
        };
        const apiKey = "";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

        try {
            const response = await fetchWithRetry(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            
            const part = result?.candidates?.[0]?.content?.parts?.[0];
            const audioData = part?.inlineData?.data;
            const mimeType = part?.inlineData?.mimeType;

            if (audioData && mimeType && mimeType.startsWith("audio/")) {
                const sampleRate = parseInt(mimeType.match(/rate=(\d+)/)[1], 10);
                const pcmData = base64ToArrayBuffer(audioData);
                const pcm16 = new Int16Array(pcmData);
                const wavBlob = pcmToWav(pcm16, sampleRate);
                const audioUrl = URL.createObjectURL(wavBlob);
                
                const audio = new Audio(audioUrl);
                audio.play();

                // Optional: Clean up the URL when audio finishes playing
                audio.onended = () => URL.revokeObjectURL(audioUrl);
            } else {
                console.error('Invalid audio response structure');
                errorMessage.style.display = 'block';
            }
        } catch (error) {
            console.error('TTS API call failed:', error);
            errorMessage.style.display = 'block';
        } finally {
            loadingIndicator.style.display = 'none';
            loadingText.textContent = 'AI is thinking...'; // Reset text
        }
    });
    
    // Handle structured response generation
    getStructuredResponseButton.addEventListener('click', async () => {
        const userQuery = userQueryTextarea.value.trim();
        if (userQuery === '' || !isAuthReady) return;

        responseContent.textContent = '';
        loadingText.textContent = 'Generating structured response...';
        loadingIndicator.style.display = 'flex';
        errorMessage.style.display = 'none';

        const prompt = `Generate a marketing strategy with 3 campaign ideas based on the following user request: "${userQuery}". The response should be a JSON array.`;
        
        let chatHistory = [{ role: "user", parts: [{ text: prompt }] }];

        const payload = {
            contents: chatHistory,
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        "strategy": { "type": "STRING" },
                        "campaigns": {
                            "type": "ARRAY",
                            "items": {
                                "type": "OBJECT",
                                "properties": {
                                    "name": { "type": "STRING" },
                                    "description": { "type": "STRING" },
                                    "targetAudience": { "type": "STRING" },
                                    "channels": {
                                        "type": "ARRAY",
                                        "items": { "type": "STRING" }
                                    }
                                }
                            }
                        }
                    }
                }
            };

            const apiKey = "";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

            try {
                const response = await fetchWithRetry(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                
                if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
                    const jsonText = result.candidates[0].content.parts[0].text;
                    const parsedJson = JSON.parse(jsonText);
                    
                    // Format the structured output for better readability
                    responseContent.innerHTML = `
                        <h3 class="font-bold text-lg mb-2">Marketing Strategy:</h3>
                        <p class="mb-4">${parsedJson.strategy}</p>
                        <h3 class="font-bold text-lg mb-2">Campaigns:</h3>
                        ${parsedJson.campaigns.map(campaign => `
                            <div class="mb-4 border-b pb-2">
                                <p><strong>Campaign Name:</strong> ${campaign.name}</p>
                                <p><strong>Description:</strong> ${campaign.description}</p>
                                <p><strong>Target Audience:</strong> ${campaign.targetAudience}</p>
                                <p><strong>Channels:</strong> ${campaign.channels.join(', ')}</p>
                            </div>
                        `).join('')}
                    `;

                } else {
                    responseContent.textContent = 'Sorry, I could not generate a structured response. Please try again.';
                }
            } catch (error) {
                console.error('Structured response API call failed:', error);
                errorMessage.style.display = 'block';
            } finally {
                loadingIndicator.style.display = 'none';
                loadingText.textContent = 'AI is thinking...'; // Reset text
            }
        });


        // Handle logout
        logoutButton.addEventListener('click', async () => {
            try {
                await auth.signOut();
            } catch (error) {
                console.error("Error signing out:", error);
            }
            userName = '';
            document.getElementById('user-name').value = '';
            document.getElementById('user-email').value = '';
            userQueryTextarea.value = '';
            responseContent.textContent = '';
            appSection.style.display = 'none';
            loginSection.style.display = 'block';
        });
    });
