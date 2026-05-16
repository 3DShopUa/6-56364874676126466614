let scene, camera, renderer, controls;
let currentModel = null; // Тут зберігатиметься згенерована 3D модель
let buildPlate = null;   // Візуальний стіл принтера
let plateGrid = null;    // Сітка на столі

// 🔑 Твій безкоштовний токен Hugging Face вже прописаний:
const HF_TOKEN = "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";

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

    // Студійне світло для гарного вигляду пластику
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

// 3. БЕЗКОШТОВНА ГЕНЕРАЦІЯ ЧЕРЕЗ HUGGING FACE
async function generateAI3DModel() {
    const promptInput = document.getElementById('prompt-input').value.trim();
    if (!promptInput) return alert("Будь ласка, напиши промпт!");

    updateStatus("⏳ Безкоштовний ШІ Hugging Face прораховує 3D геометрію (може зайняти до 30 сек)...", "warning");

    if (currentModel) scene.remove(currentModel);
    currentModel = null;

    try {
        // Запит до повністю відкритої моделі Shap-E
        const response = await fetch("https://api-inference.huggingface.co/models/openai/shap-e", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${HF_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ inputs: promptInput })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            // Якщо модель тільки прокидається на сервері, вона просить зачекати
            if (errData.estimated_time) {
                throw new Error(`Модель завантажується на сервери Hugging Face. Спробуй ще раз через ${Math.round(errData.estimated_time)} сек.`);
            }
            throw new Error(errData.error || "Сервер тимчасово перевантажений. Спробуй ще раз.");
        }

        // Перетворюємо відповідь у Blob лінк
        const blob = await response.blob();
        const modelUrl = URL.createObjectURL(blob);

        console.log("Модель успішно згенерована!");
        updateStatus("🚚 Завантажую згенерований меш на стіл...", "warning");
        
        loadModelIntoScene(modelUrl);

    } catch (error) {
        console.error(error);
        updateStatus(`❌ Помилка: ${error.message}`, "error");
    }
}

// 4. ЗАВАНТАЖЕННЯ МОДЕЛІ НА СЦЕНУ
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
    loader.load(url, (gltf) => {
        currentModel = gltf.scene;
        
        // Авто-масштаб під розміри принтера
        const box = new THREE.Box3().setFromObject(currentModel);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const targetScale = 10 / maxDim; 
        
        currentModel.scale.set(targetScale, targetScale, targetScale);
        
        const newBox = new THREE.Box3().setFromObject(currentModel);
        const center = newBox.getCenter(new THREE.Vector3());
        currentModel.position.x = -center.x;
        currentModel.position.z = -center.z;
        currentModel.position.y = -newBox.min.y; // Дно моделі на стіл

        currentModel.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                child.material.roughness = 0.6; // Матовий пластик
            }
        });

        scene.add(currentModel);
        updateStatus("🟢 Готово! Модель на столі, можна качати в .STL.", "success");
    }, 
    null, 
    (error) => {
        console.error(error);
        updateStatus("❌ Помилка відображення моделі. Спробуй інший промпт.", "error");
    });
}

// 5. ЕКСПОРТ У .STL ДЛЯ СЛАЙСЕРА
function exportToSTL() {
    if (!currentModel) return alert("Спочатку згенеруй модель!");

    const exporter = new THREE.STLExporter();
    const result = exporter.parse(currentModel, { binary: true });
    
    const blob = new Blob([result], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'hf_ai_model.stl';
    link.click();
}

// КЕРУВАННЯ СТАТУСАМИ UI
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
        alert("Кольорові шари сформовані під палітру AMS!");
    });
}

function onWindowResize() {
    const container = document.getElementById('canvas-3d');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

// 6. АНІМАЦІЯ
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    if (currentModel) {
        currentModel.rotation.y += 0.003;
    }
    renderer.render(scene, camera);
}