let scene, camera, renderer, controls;
let currentModel = null; // Тут зберігатиметься згенерована 3D модель
let buildPlate = null;   // Візуальний стіл принтера
let plateGrid = null;    // Сітка на столі

// 🔑 Твій перевірений API ключ від Tripo3D вже тут:
const TRIPO3D_API_KEY = "tsk_KQ55Z3u6gxalMfSWXCTLNxYcJujCHw7lwW3Qxa3o7vR";

// Спеціальний CORS-проксі для обходу блокування при запуску з локального файлу (file:///)
const PROXY_URL = "https://corsproxy.io/?";

// Розміри столів для різних принтерів (у мм, але в Three.js ділимо на 10 для зручності)
const PRINTER_PROFILES = {
    'single-color': { width: 22, depth: 22, name: "Elegoo/Endure (220x220 мм)" },
    'multi-color':  { width: 18, depth: 18, name: "Bambu Mini / AMS (180x180 мм)" },
    'large':        { width: 30, depth: 30, name: "Neptune Max (300x300 мм)" }
};

window.addEventListener('DOMContentLoaded', () => {
    init3DViewer();
    setupAppEvents();
    updateBuildPlate('single-color');
    animate();
});

// 1. ІНІЦІАЛІЗАЦІЯ 3D СЦЕНИ
function init3DViewer() {
    const container = document.getElementById('canvas-3d');
    
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x121214);

    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(25, 20, 25);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;

    // Освітлення столу
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8); 
    dirLight.position.set(20, 40, 20);
    dirLight.castShadow = true;
    scene.add(dirLight);

    window.addEventListener('resize', onWindowResize);
}

// 2. ОНОВЛЕННЯ СТОЛУ ПРИНТЕРА
function updateBuildPlate(profileKey) {
    if (buildPlate) scene.remove(buildPlate);
    if (plateGrid) scene.remove(plateGrid);

    const profile = PRINTER_PROFILES[profileKey];

    const plateGeo = new THREE.BoxGeometry(profile.width, 0.2, profile.depth);
    const plateMat = new THREE.MeshStandardMaterial({ color: 0x242427, roughness: 0.8 });
    
    buildPlate = new THREE.Mesh(plateGeo, plateMat);
    buildPlate.position.y = -0.1; 
    buildPlate.receiveShadow = true;
    scene.add(buildPlate);

    plateGrid = new THREE.GridHelper(profile.width, profile.width, 0xa855f7, 0x3f3f46);
    plateGrid.position.y = 0.01; 
    scene.add(plateGrid);

    controls.target.set(0, 0, 0);
}

// 3. НАДСИЛАННЯ ЗАПИТУ ДО СЛУЖБИ ШІ (ЧЕРЕЗ CORS ПРОКСІ)
async function generateAI3DModel() {
    const promptInput = document.getElementById('prompt-input').value.trim();
    if (!promptInput) return alert("Будь ласка, напиши промпт!");

    updateStatus("⏳ Надсилаю запит до нейромережі Tripo3D...", "warning");

    if (currentModel) scene.remove(currentModel);
    currentModel = null;

    // Словничок для швидкого автоматичного перекладу
    let finalPrompt = promptInput.toLowerCase();
    if (finalPrompt.includes("кішка") || finalPrompt.includes("кіт")) finalPrompt = "a small cat";
    if (finalPrompt.includes("качка")) finalPrompt = "a yellow plastic duck";
    if (finalPrompt.includes("меч")) finalPrompt = "pixel diamond sword";
    if (finalPrompt.includes("шестерня")) finalPrompt = "mechanical industrial gear";

    try {
        // Запит А: Створення таски (пускаємо через проксі-сервер corsproxy.io)
        const targetUrl = "https://api.tripo3d.ai/v2/openapi/task";
        const response = await fetch(PROXY_URL + encodeURIComponent(targetUrl), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${TRIPO3D_API_KEY}`
            },
            body: JSON.stringify({
                type: "text_to_model",
                prompt: finalPrompt
            })
        });

        const data = await response.json();
        
        if (data.code !== 0 || !data.data || !data.data.task_id) {
            throw new Error(data.message || "Сервер повернув помилку. Можливо закінчилися безкоштовні ліміти.");
        }

        const taskId = data.data.task_id;
        console.log("Завдання створено! ID:", taskId);
        
        // Запит Б: Починаємо циклічно опитувати сервер про готовність
        checkTaskStatus(taskId);

    } catch (error) {
        console.error(error);
        updateStatus(`❌ Помилка сервера: ${error.message}`, "error");
    }
}

// Перевірка статусу кожні 3 секунди
async function checkTaskStatus(taskId) {
    const interval = setInterval(async () => {
        try {
            const targetUrl = `https://api.tripo3d.ai/v2/openapi/task/${taskId}`;
            const response = await fetch(PROXY_URL + encodeURIComponent(targetUrl), {
                method: "GET",
                headers: { "Authorization": `Bearer ${TRIPO3D_API_KEY}` }
            });
            const data = await response.json();
            const task = data.data;

            if (task.status === "success") {
                clearInterval(interval);
                updateStatus("🚚 Модель згенерована! Завантажую на стіл принтера...", "warning");
                
                // Беремо лінк на готовий файл
                const modelUrl = task.output.model;
                loadModelIntoScene(modelUrl);
            } 
            else if (task.status === "failed") {
                clearInterval(interval);
                updateStatus("❌ ШІ не зміг прорахувати цю модель.", "error");
            } 
            else {
                const progress = task.progress ? ` (${task.progress}%)` : "...";
                updateStatus(`⏳ Генерація моделі штучним інтелектом${progress}`, "warning");
            }

        } catch (error) {
            clearInterval(interval);
            console.error(error);
            updateStatus("❌ Помилка з'єднання під час перевірки статусу", "error");
        }
    }, 3000);
}

// Завантаження файлу на 3D сцену (також через проксі для уникнення CORS)
function loadModelIntoScene(url) {
    if (typeof THREE.GLTFLoader === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js';
        script.onload = () => runLoader(url);
        document.head.appendChild(script);
    } else {
        runLoader(url);
    }
}

function runLoader(url) {
    const loader = new THREE.GLTFLoader();
    // Проганяємо лінк завантаження 3D моделі теж через проксі
    const proxiedModelUrl = PROXY_URL + encodeURIComponent(url);

    loader.load(proxiedModelUrl, (gltf) => {
        currentModel = gltf.scene;
        
        // Автоматичне вирівнювання розмірів під область друку
        const box = new THREE.Box3().setFromObject(currentModel);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const targetScale = 9 / maxDim; // Оптимальний розмір на платі
        
        currentModel.scale.set(targetScale, targetScale, targetScale);
        
        const newBox = new THREE.Box3().setFromObject(currentModel);
        const center = newBox.getCenter(new THREE.Vector3());
        currentModel.position.x = -center.x;
        currentModel.position.z = -center.z;
        currentModel.position.y = -newBox.min.y; // Ставимо точно "підошвою" на стіл

        currentModel.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                child.material.roughness = 0.5; // Ефект матового пластику друку
            }
        });

        scene.add(currentModel);
        updateStatus("🟢 Успішно! Модель готова до експорту в STL.", "success");
    }, 
    null, 
    (error) => {
        console.error(error);
        updateStatus("❌ Помилка рендеру завантаженого файлу", "error");
    });
}

// 4. ЕКСПОРТ У СТАНДАРТНИЙ .STL
function exportToSTL() {
    if (!currentModel) return alert("Немає придатної моделі для збереження!");

    const exporter = new THREE.STLExporter();
    const result = exporter.parse(currentModel, { binary: true });
    
    const blob = new Blob([result], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'ai_model_print_ready.stl';
    link.click();
}

// 5. КЕРУВАННЯ СТАТУСАМИ
function updateStatus(text, type) {
    const statusBar = document.getElementById('status-bar');
    statusBar.innerText = text;
    if (type === "success") {
        statusBar.style.backgroundColor = "rgba(34, 197, 94, 0.1)";
        statusBar.style.borderColor = "rgba(34, 197, 94, 0.2)";
        statusBar.style.color = "#22c55e";
    } else if (type === "warning") {
        statusBar.style.backgroundColor = "rgba(234, 179, 8, 0.1)";
        statusBar.style.borderColor = "rgba(234, 179, 8, 0.2)";
        statusBar.style.color = "#eab308";
    } else if (type === "error") {
        statusBar.style.backgroundColor = "rgba(239, 68, 68, 0.1)";
        statusBar.style.borderColor = "rgba(239, 68, 68, 0.2)";
        statusBar.style.color = "#ef4444";
    }
}

function setupAppEvents() {
    document.getElementById('printer-select').addEventListener('change', (e) => {
        updateBuildPlate(e.target.value);
    });
    document.getElementById('btn-generate').addEventListener('click', generateAI3DModel);
    document.getElementById('btn-export-stl').addEventListener('click', exportToSTL);
    document.getElementById('btn-export-color').addEventListener('click', () => {
        if (!currentModel) return alert("Спочатку згенеруй модель!");
        alert("Кольорові текстури готові для обробки слайсером AMS!");
    });
}

function onWindowResize() {
    const container = document.getElementById('canvas-3d');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

// 6. ОСНОВНИЙ ЦИКЛ ОБЕРТАННЯ
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    if (currentModel) {
        currentModel.rotation.y += 0.003;
    }
    renderer.render(scene, camera);
}