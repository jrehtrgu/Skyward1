import * as THREE from 'three';
import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

let scene, camera, renderer;
let spaceship;
let loaderFBX;

// CANNON
let world;
let spaceshipBody; 

// Variables de vuelo
let velocity = new THREE.Vector3();
let acceleration = 0;
let rotationSpeed = { x: 0, y: 0, z: 0 };
const maxSpeed = 50;
const maxAcceleration = 0.5;
const friction = 0.98;

// Estadisticas del juego
let shield = 100;
let score = 0;
let gameTime = 0;
let gameActive = true;

// Objetos del juego
const enemies = [];
const projectiles = [];
const explosions = [];

// Controles
const keys = {};
let turboActive = false;
let shootCooldown = 0.2;
let lastShootTime = 0;

// Sistema de enemigos
const ENEMY_LIMIT = 4;
const MIN_ENEMIES = 1;
let enemySpawnTimer = 0;
const ENEMY_SPAWN_INTERVAL = 4.0;

// Controles Gamepad
let gamepadIndex = null;

// Sistema de Audio
let listener, shootSound, ambientSound, explosionSound, enemyShootSound;

// VR Controllers
let controller1, controller2;
let controllerGrip1, controllerGrip2;

// HUD 3D
let hudElements = {};

// ==== Tipos de enemigos ====================
const ENEMY_TYPES = {
    scout: { 
        health: 2, 
        speed: 8, 
        size: 1.2, 
        color: 0x00ff88,
        points: 100,
        fireRate: 1.5,
        model: 'TieInterceptor_Upload.blend.fbx',
        scale: 0.03
    },
    fighter: { 
        health: 4, 
        speed: 5, 
        size: 1.5, 
        color: 0xffaa00,
        points: 200,
        fireRate: 2.0,
        model: 'scene2.fbx',
        scale: 0.01
    },
    heavy: { 
        health: 8, 
        speed: 3, 
        size: 2.0, 
        color: 0x134686, // Color corregido
        points: 400,
        fireRate: 3.0,
        model: 'scene2.fbx',
        scale: 0.01
    }
};

const LOADED_MODELS = {};

async function init() {
    // Escena
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.00025);

    // Cámara
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);

    // ==================== SISTEMA DE AUDIO ====================
    listener = new THREE.AudioListener();
    camera.add(listener);

    const audioLoader = new THREE.AudioLoader();

    // Crear audios
    shootSound = new THREE.Audio(listener); 
    ambientSound = new THREE.Audio(listener);
    explosionSound = new THREE.Audio(listener);
    enemyShootSound = new THREE.Audio(listener);

    // Cargar sonidos (con manejo de errores)
    try {
        audioLoader.load('sounds/shoot.mp3', (buffer) => {
            shootSound.setBuffer(buffer);
            shootSound.setVolume(1);
        });
    } catch (error) {
        console.warn('No se pudo cargar shoot.mp3');
    }

    try {
        audioLoader.load('sounds/battle_ambient.mp3', (buffer) => {
            ambientSound.setBuffer(buffer);
            ambientSound.setLoop(true);
            ambientSound.setVolume(0.25);
        });
    } catch (error) {
        console.warn('No se pudo cargar battle_ambient.mp3');
    }

    try {
        audioLoader.load('sounds/explosionSound.mp3', (buffer) => {
            explosionSound.setBuffer(buffer);
            explosionSound.setVolume(0.7);
        });
    } catch (error) {
        console.warn('No se pudo cargar explosionSound.mp3');
    }

    try {
        audioLoader.load('sounds/enemyShootSound.mp3', (buffer) => {
            enemyShootSound.setBuffer(buffer);
            enemyShootSound.setVolume(0.3);
        });
    } catch (error) {
        console.warn('No se pudo cargar enemyShootSound.mp3');
    }

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // ==================== CONFIGURACIÓN VR ====================
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);
    
    // Botón VR
    document.body.appendChild(VRButton.createButton(renderer));

    loaderFBX = new FBXLoader();

    // ========= CANNON =========
    world = new CANNON.World({
        gravity: new CANNON.Vec3(0, 0, 0)
    });
    world.broadphase = new CANNON.NaiveBroadphase();
    world.allowSleep = true;

    // Material por defecto 
    const defaultMat = new CANNON.Material('default');
    const contactMat = new CANNON.ContactMaterial(defaultMat, defaultMat, {
        friction: 0.0,
        restitution: 0.3
    });
    world.addContactMaterial(contactMat);
    world.defaultContactMaterial = contactMat;

    // Crear elementos del juego
    createSpaceship();
    createStarField();
    
    // Luces
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(10, 10, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);
    
    // ==================== CONFIGURACIÓN CONTROLADORES VR ====================
    setupVRControllers();
    
    // Event listeners
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('click', () => {
        if (!renderer.xr.isPresenting) {
            shoot();
        }
    });
    
    // Boton de reinicio
    const restartBtn = document.getElementById('restart-button');
    if (restartBtn) restartBtn.addEventListener('click', restartGame);
    
    await preloadEnemyModels();
    spawnInitialEnemies();
    updateShieldBar();
    
    // Iniciar audio ambiente si está disponible
    if (ambientSound && ambientSound.buffer && ambientSound.context.state === 'running') {
        ambientSound.play();
    }
}

function setupVRControllers() {
    const controllerModelFactory = new XRControllerModelFactory();
    
    // Controlador izquierdo (0)
    controller1 = renderer.xr.getController(0);
    controller1.addEventListener('selectstart', onSelectStart);
    controller1.addEventListener('selectend', onSelectEnd);
    controller1.addEventListener('squeezestart', onSqueezeStart);
    controller1.addEventListener('squeezeend', onSqueezeEnd);
    scene.add(controller1);
    
    controllerGrip1 = renderer.xr.getControllerGrip(0);
    controllerGrip1.add(controllerModelFactory.createControllerModel(controllerGrip1));
    scene.add(controllerGrip1);
    
    // Controlador derecho (1)
    controller2 = renderer.xr.getController(1);
    controller2.addEventListener('selectstart', onSelectStart);
    controller2.addEventListener('selectend', onSelectEnd);
    controller2.addEventListener('squeezestart', onSqueezeStart);
    controller2.addEventListener('squeezeend', onSqueezeEnd);
    scene.add(controller2);
    
    controllerGrip2 = renderer.xr.getControllerGrip(1);
    controllerGrip2.add(controllerModelFactory.createControllerModel(controllerGrip2));
    scene.add(controllerGrip2);
    
    // Rayos para los controladores 
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3));
    
    const material = new THREE.LineBasicMaterial({ 
        color: 0x00ffff,
        blending: THREE.AdditiveBlending,
        linewidth: 2
    });
    
    const line1 = new THREE.Line(geometry, material);
    line1.scale.z = 5;
    controller1.add(line1.clone());
    
    const line2 = new THREE.Line(geometry, material);
    line2.scale.z = 5;
    controller2.add(line2.clone());
}

function onSelectStart(event) {
    shoot();
    
    // Feedback visual
    const controller = event.target;
    if (controller.children.length > 0) {
        const line = controller.children[0];
        if (line && line.scale) {
            line.scale.z = 10;
            line.material.opacity = 1.0;
        }
    }
}

function onSelectEnd(event) {
    const controller = event.target;
    if (controller.children.length > 0) {
        const line = controller.children[0];
        if (line && line.scale) {
            line.scale.z = 5;
            line.material.opacity = 0.8;
        }
    }
}

function onSqueezeStart(event) {
    turboActive = true;
}

function onSqueezeEnd(event) {
    turboActive = false;
}

// ==================== CREAR HUD EN PLANOS 3D  ====================

function create3DHUD() {
    // Función para crear sprite de texto
    function createTextSprite(text, position, rotation, isRadar = false, panelType = 'left') {
        const textureCanvas = document.createElement('canvas');
        const context = textureCanvas.getContext('2d');
        textureCanvas.width = 512;
        textureCanvas.height = 256;

        // Fondo 
        context.fillStyle = 'rgba(0, 10, 20, 0.7)';
        context.fillRect(0, 0, textureCanvas.width, textureCanvas.height);

        // Borde 
        context.strokeStyle = 'rgba(0, 255, 255, 0.6)';
        context.lineWidth = 2;
        context.strokeRect(0, 0, textureCanvas.width, textureCanvas.height);

        if (isRadar) {
            // Panel del radar
            context.font = 'bold 22px Arial';
            context.fillStyle = '#00ffff';
            context.textAlign = 'center';
            context.textBaseline = 'top';
            context.fillText('RADAR DE AMENAZAS', textureCanvas.width/2, 20);
            
            // Dibujar radar
            drawRadarOnCanvas(context, textureCanvas.width, textureCanvas.height);
        } else {
            // Título del panel
            context.font = 'bold 18px Arial';
            context.fillStyle = '#00ffff';
            context.textAlign = 'center';
            context.textBaseline = 'top';
            
            const title = panelType === 'left' ? 'INFORMACIÓN DE COMBATE' : 'ESTADO DE LA NAVE';
            context.fillText(title, textureCanvas.width/2, 12);
            
            // Línea divisoria
            context.strokeStyle = 'rgba(0, 255, 255, 0.4)';
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(20, 40);
            context.lineTo(textureCanvas.width-20, 40);
            context.stroke();

            // Contenido del panel
            context.font = '14px Arial';
            context.fillStyle = '#7fffff';
            context.textAlign = 'left';
            context.textBaseline = 'middle';

            const lines = text.split('\n');
            const lineHeight = 22;
            const startY = 60;

            lines.forEach((line, index) => {
                const [label, value] = line.split(':');
                if (label && value) {
                    context.fillStyle = '#7fffff';
                    context.fillText(label + ':', 25, startY + (index * lineHeight));
                    
                    context.fillStyle = '#00ffff';
                    context.textAlign = 'right';
                    context.fillText(value.trim(), textureCanvas.width - 25, startY + (index * lineHeight));
                    context.textAlign = 'left';
                }
            });

            // Barra de escudo 
            if (panelType === 'right' && text.includes('Escudo:')) {
                const shieldValue = parseInt(text.split('\n')[1].split(':')[1].trim());
                const barY = startY + (lines.length * lineHeight) + 10; 
                
                context.fillStyle = 'rgba(0, 51, 51, 0.8)';
                context.fillRect(25, barY, textureCanvas.width - 50, 8);

                context.strokeStyle = 'rgba(0, 255, 255, 0.7)';
                context.lineWidth = 1;
                context.strokeRect(25, barY, textureCanvas.width - 50, 8);
                
                // Relleno 
                const barWidth = ((textureCanvas.width - 50) * shieldValue) / 100;
        
                // Color según el porcentaje
                if (shieldValue > 70) {
                    context.fillStyle = '#00ff00';
                } else if (shieldValue > 30) {
                    context.fillStyle = '#ffff00';
                } else {
                    context.fillStyle = '#ff0000';
                }
                
                context.fillRect(25, barY, barWidth, 8);
            }
        }

        const texture = new THREE.CanvasTexture(textureCanvas);
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: 0.9, 
            depthTest: false
        });

        const sprite = new THREE.Sprite(material);
        sprite.position.copy(position);
        sprite.rotation.copy(rotation);
        
        // Escalas para visibilidad
        if (isRadar) {
            sprite.scale.set(1.2, 1.2, 1);
        } else {
            sprite.scale.set(2.5, 1.7, 1);
        }

        return { sprite: sprite, material: material };
    }

    // ==================== POSICIONES FIJAS RELATIVAS A LA NAVE ====================

    // Panel 1: Información de Combate (izquierda)
    const panel1Pos = new THREE.Vector3(-2, 1.2, -3);
    const panel1Rot = new THREE.Euler(-Math.PI / 12, Math.PI / 9, 0);
    
    const text1 = createTextSprite(
        'Enemigos: 0/4\nPuntuación: 0\nTiempo: 0s', 
        panel1Pos,
        panel1Rot,
        false,
        'left'
    );
    
    // Panel 2: Estado de la Nave (derecha)
    const panel2Pos = new THREE.Vector3(2, 1.2, -3);
    const panel2Rot = new THREE.Euler(-Math.PI / 12, -Math.PI / 9, 0);
    
    const text2 = createTextSprite(
        'Velocidad: 0 km/s\nEscudo: 100%\nMás Cercano: -', 
        panel2Pos,
        panel2Rot,
        false,
        'right'
    );
    
    // Panel 3: Radar (centro abajo)
    const panel3Pos = new THREE.Vector3(0, -1, -1);
    const panel3Rot = new THREE.Euler(-Math.PI / 20, 0, 0);
    
    const text3 = createTextSprite(
        '', 
        panel3Pos,
        panel3Rot,
        true
    );

    // Añadir a la nave para que se muevan con ella
    spaceship.add(text1.sprite);
    spaceship.add(text2.sprite);
    spaceship.add(text3.sprite);

    // Guardar referencias
    hudElements = {
        panel1: text1,
        panel2: text2,
        panel3: text3
    };
}

// ==================== DIBUJAR RADAR EN CANVAS ====================
function drawRadarOnCanvas(context, width, height) {
    const centerX = width / 2;
    const centerY = height / 2;
    const radarRadius = 80;
    
    // Fondo del radar 
    context.fillStyle = 'rgba(0, 17, 34, 0.7)';
    context.beginPath();
    context.arc(centerX, centerY, radarRadius, 0, Math.PI * 2);
    context.fill();
    
    // Borde del radar
    context.strokeStyle = 'rgba(0, 255, 255, 0.8)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(centerX, centerY, radarRadius, 0, Math.PI * 2);
    context.stroke();
    
    // Grid del radar 
    context.strokeStyle = 'rgba(0, 136, 136, 0.4)';
    context.lineWidth = 1;
    
    // Líneas horizontales y verticales
    for (let i = 1; i <= 2; i++) {
        const spacing = radarRadius / 3;
        
        // Horizontal
        context.beginPath();
        context.moveTo(centerX - radarRadius, centerY - spacing * i);
        context.lineTo(centerX + radarRadius, centerY - spacing * i);
        context.stroke();
        
        context.beginPath();
        context.moveTo(centerX - radarRadius, centerY + spacing * i);
        context.lineTo(centerX + radarRadius, centerY + spacing * i);
        context.stroke();
        
        // Vertical
        context.beginPath();
        context.moveTo(centerX - spacing * i, centerY - radarRadius);
        context.lineTo(centerX - spacing * i, centerY + radarRadius);
        context.stroke();
        
        context.beginPath();
        context.moveTo(centerX + spacing * i, centerY - radarRadius);
        context.lineTo(centerX + spacing * i, centerY + radarRadius);
        context.stroke();
    }
    
    // Centro del radar
    context.fillStyle = '#00ffff';
    context.beginPath();
    context.arc(centerX, centerY, 4, 0, Math.PI * 2);
    context.fill();
    
    // Flecha del jugador
    context.fillStyle = '#00ffff';
    context.beginPath();
    context.moveTo(centerX, centerY - 14);
    context.lineTo(centerX - 6, centerY + 7);
    context.lineTo(centerX + 6, centerY + 7);
    context.closePath();
    context.fill();
    
    // Barrido del radar 
    const sweepAngle = (Date.now() / 30) % 360;
    context.fillStyle = 'rgba(0, 136, 136, 0.3)';
    context.beginPath();
    context.moveTo(centerX, centerY);
    context.arc(centerX, centerY, radarRadius, (sweepAngle - 30) * Math.PI / 180, sweepAngle * Math.PI / 180);
    context.closePath();
    context.fill();
    
    // Etiquetas del radar
    context.font = '10px Arial';
    context.fillStyle = 'rgba(0, 255, 255, 0.9)';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    
    context.fillText('FRONT', centerX, centerY - radarRadius - 12);
    context.fillText('BACK', centerX, centerY + radarRadius + 12);
    context.fillText('LEFT', centerX - radarRadius - 16, centerY);
    context.fillText('RIGHT', centerX + radarRadius + 16, centerY);
}

// ==================== ACTUALIZAR TEXTURA DE HUD ====================
function updateHUDTexture(textElement, text, isRadar = false, panelType = 'left') {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = 256;

    // Fondo 
    context.fillStyle = 'rgba(0, 10, 20, 0.7)';
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Borde
    context.strokeStyle = 'rgba(0, 255, 255, 0.6)';
    context.lineWidth = 2;
    context.strokeRect(0, 0, canvas.width, canvas.height);

    if (isRadar) {
        // Panel 
        context.font = 'bold 22px Arial';
        context.fillStyle = '#00ffff';
        context.textAlign = 'center';
        context.textBaseline = 'top';
        context.fillText('', canvas.width/2, 20);
        // Dibujar radar con enemigos
        drawRadarWithEnemies(context, canvas.width, canvas.height);
    } else {
        context.font = 'bold 18px Arial';
        context.fillStyle = '#00ffff';
        context.textAlign = 'center';
        context.textBaseline = 'top';
        
        const title = panelType === 'left' ? 'INFORMACIÓN DE COMBATE' : 'ESTADO DE LA NAVE';
        context.fillText(title, canvas.width/2, 12);
        
        // Línea divisoria
        context.strokeStyle = 'rgba(0, 255, 255, 0.4)';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(20, 40);
        context.lineTo(canvas.width-20, 40);
        context.stroke();

        // Contenido del panel
        context.font = '14px Arial';
        context.fillStyle = '#7fffff';
        context.textAlign = 'left';
        context.textBaseline = 'middle';

        const lines = text.split('\n');
        const lineHeight = 22;
        const startY = 60;

        lines.forEach((line, index) => {
            const [label, value] = line.split(':');
            if (label && value) {
                context.fillStyle = '#7fffff';
                context.fillText(label + ':', 25, startY + (index * lineHeight));
                
                context.fillStyle = '#00ffff';
                context.textAlign = 'right';
                context.fillText(value.trim(), canvas.width - 25, startY + (index * lineHeight));
                context.textAlign = 'left';
            }
        });

        // Barra de escudo
        if (panelType === 'right' && text.includes('Escudo:')) {
            const shieldValue = parseInt(text.split('\n')[1].split(':')[1].trim());
            const barY = startY + (lines.length * lineHeight) + 10;
            
            // Fondo de la barra con transparencia
            context.fillStyle = 'rgba(0, 51, 51, 0.8)';
            context.fillRect(25, barY, canvas.width - 50, 8);
            
            // Borde de la barra
            context.strokeStyle = 'rgba(0, 255, 255, 0.7)';
            context.lineWidth = 1;
            context.strokeRect(25, barY, canvas.width - 50, 8);
            
            // Relleno de la barra
            const barWidth = ((canvas.width - 50) * shieldValue) / 100;
            
            if (shieldValue > 70) {
                context.fillStyle = '#00ff00';
            } else if (shieldValue > 30) {
                context.fillStyle = '#ffff00';
            } else {
                context.fillStyle = '#ff0000';
            }
            
            context.fillRect(25, barY, barWidth, 8);
        }
    }

    // Actualizar textura
    if (textElement.material.map) {
        textElement.material.map.dispose();
    }
    textElement.material.map = new THREE.CanvasTexture(canvas);
    textElement.material.needsUpdate = true;
}

// ==================== DIBUJAR RADAR CON ENEMIGOS ====================
function drawRadarWithEnemies(context, width, height) {
    const centerX = width / 2;
    const centerY = height / 2;
    const radarRadius = 80;
    
    // Fondo 
    context.fillStyle = 'rgba(0, 17, 34, 0.7)';
    context.beginPath();
    context.arc(centerX, centerY, radarRadius, 0, Math.PI * 2);
    context.fill();
    
    // Borde
    context.strokeStyle = 'rgba(0, 255, 255, 0.8)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(centerX, centerY, radarRadius, 0, Math.PI * 2);
    context.stroke();
    
    // Grid del radar
    context.strokeStyle = 'rgba(0, 255, 255, 0.3)';
    context.lineWidth = 1;
    
    // Líneas horizontales y verticales
    for (let i = 1; i <= 2; i++) {
        const spacing = radarRadius / 3;
        
        // Horizontal
        context.beginPath();
        context.moveTo(centerX - radarRadius, centerY - spacing * i);
        context.lineTo(centerX + radarRadius, centerY - spacing * i);
        context.stroke();
        
        context.beginPath();
        context.moveTo(centerX - radarRadius, centerY + spacing * i);
        context.lineTo(centerX + radarRadius, centerY + spacing * i);
        context.stroke();
        
        // Vertical
        context.beginPath();
        context.moveTo(centerX - spacing * i, centerY - radarRadius);
        context.lineTo(centerX - spacing * i, centerY + radarRadius);
        context.stroke();
        
        context.beginPath();
        context.moveTo(centerX + spacing * i, centerY - radarRadius);
        context.lineTo(centerX + spacing * i, centerY + radarRadius);
        context.stroke();
    }
    
    // Centro del radar
    context.fillStyle = '#0ff';
    context.beginPath();
    context.arc(centerX, centerY, 4, 0, Math.PI * 2);
    context.fill();
    
    // Flecha del jugador 
    const playerRotation = spaceship.rotation.y;
    context.save();
    context.translate(centerX, centerY);
    context.rotate(playerRotation);
    context.fillStyle = '#0ff';
    context.beginPath();
    context.moveTo(0, -14);
    context.lineTo(-6, 7);
    context.lineTo(6, 7);
    context.closePath();
    context.fill();
    context.restore();
    
    // Barrido del radar (animación)
    const sweepAngle = (Date.now() / 30) % 360;
    context.fillStyle = 'rgba(0, 255, 255, 0.3)';
    context.beginPath();
    context.moveTo(centerX, centerY);
    context.arc(centerX, centerY, radarRadius, (sweepAngle - 30) * Math.PI / 180, sweepAngle * Math.PI / 180);
    context.closePath();
    context.fill();
    
    // Dibujar enemigos en el radar
    enemies.forEach(enemy => {
        const enemyPos = enemy.userData.body ? 
            new THREE.Vector3(enemy.userData.body.position.x, enemy.userData.body.position.y, enemy.userData.body.position.z) : 
            enemy.position;
        
        const relativePos = enemyPos.clone().sub(spaceship.position);
        const distance = relativePos.length();
        
        if (distance < 200) { 
            // Convertir a coordenadas de radar (2D)
            const radarX = (relativePos.x / 200) * radarRadius;
            const radarZ = (relativePos.z / 200) * radarRadius;
            
            // Rotar según la orientación del jugador
            const angle = -playerRotation;
            const rotatedX = radarX * Math.cos(angle) - radarZ * Math.sin(angle);
            const rotatedZ = radarX * Math.sin(angle) + radarZ * Math.cos(angle);
            
            const screenX = centerX + rotatedX;
            const screenY = centerY + rotatedZ;
            
            // Dibujar punto de enemigo
            let enemyColor;
            switch(enemy.userData.type) {
                case 'scout': enemyColor = '#00ff88'; break;
                case 'fighter': enemyColor = '#ffaa00'; break;
                case 'heavy': enemyColor = '#134686'; break; // Color corregido
                default: enemyColor = '#ff0000';
            }
            
            const size = Math.max(4, 8 - (distance / 200 * 4));
            
            context.fillStyle = enemyColor;
            context.beginPath();
            context.arc(screenX, screenY, size, 0, Math.PI * 2);
            context.fill();
        }
    });
    
    // Etiquetas del radar
    context.font = '10px Arial';
    context.fillStyle = 'rgba(0, 255, 255, 0.9)';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    
    context.fillText('FRONT', centerX, centerY - radarRadius - 12);
    context.fillText('BACK', centerX, centerY + radarRadius + 12);
    context.fillText('LEFT', centerX - radarRadius - 16, centerY);
    context.fillText('RIGHT', centerX + radarRadius + 16, centerY);
}

// ==================== FUNCIÓN AUXILIAR PARA DISTANCIA DEL ENEMIGO MÁS CERCANO ====================
function getClosestEnemyDistance() {
    let closestDistance = Infinity;
    
    enemies.forEach(enemy => {
        const enemyPos = enemy.userData.body
            ? new THREE.Vector3(enemy.userData.body.position.x, enemy.userData.body.position.y, enemy.userData.body.position.z)
            : enemy.position;
        const distance = enemyPos.distanceTo(spaceship.position);
        closestDistance = Math.min(closestDistance, distance);
    });
    
    return closestDistance === Infinity ? -1 : closestDistance;
}

// ==================== CREAR NAVE JUGADOR  ====================
function createSpaceship() {
    spaceship = new THREE.Group();
    
    // Cuerpo 
    loaderFBX.load("scene.fbx", function(object) {
        object.scale.set(1, 1, 1);
        object.rotation.z = Math.PI / 2;  
        object.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                if (child.material) {
                    child.material.metalness = 0.8;
                    child.material.roughness = 0.2;
                    child.material.needsUpdate = true;
                }
            }
        });
        object.position.set(0, -1, 0);
        spaceship.add(object);       
    });
    
    scene.add(spaceship);
    
    // Configurar cámara según el modo
    if (!renderer.xr.isPresenting) {
        camera.position.set(0, 0.5, 1.5);
        spaceship.add(camera);
    }

    // Crear cuerpo físico de la nave
    const shipShape = new CANNON.Box(new CANNON.Vec3(1.2, 1.2, 1.8));
    spaceshipBody = new CANNON.Body({
        mass: 5,
        position: new CANNON.Vec3(0, 0, 0),
        shape: shipShape,
        linearDamping: 1 - friction, 
        angularDamping: 0.9
    });
    world.addBody(spaceshipBody);
    
    // ==================== CREAR HUD 3D  ====================
    create3DHUD();
}

function createStarField() {
    const starGeometry = new THREE.BufferGeometry();
    const starMaterial = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.7,
        sizeAttenuation: true
    });
    
    const starVertices = [];
    for (let i = 0; i < 5000; i++) {
        const x = (Math.random() - 0.5) * 5000;
        const y = (Math.random() - 0.5) * 5000;
        const z = (Math.random() - 0.5) * 5000;
        starVertices.push(x, y, z);
    }
    
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
    const starField = new THREE.Points(starGeometry, starMaterial);
    scene.add(starField);
}

// ==================== PRECARGA DE MODELOS DE ENEMIGOS ====================
async function preloadEnemyModels() {
    const loadPromises = Object.entries(ENEMY_TYPES).map(([type, config]) => {
        return new Promise((resolve) => {
            loaderFBX.load(
                config.model,
                (object) => {
                    object.scale.set(config.scale, config.scale, config.scale);
                    
                    object.traverse((child) => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                            if (child.material) {
                                child.material.metalness = 0.8;
                                child.material.roughness = 0.2;
                            }
                        }
                    });
                    
                    LOADED_MODELS[type] = object;
                    console.log(` Modelo ${type} cargado`);
                    resolve();
                }
            );
        });
    });
    
    await Promise.all(loadPromises);
}

// ==================== SISTEMA DE ENEMIGOS ====================
function spawnInitialEnemies() {
    const initialCount = Math.floor(Math.random() * 2) + 1;
    for (let i = 0; i < initialCount; i++) {
        spawnEnemy();
    }
}

function calculateEnemyWeights() {
    const timeFactor = Math.min(gameTime / 300, 1);
    const scoreFactor = Math.min(score / 5000, 1);
    const difficulty = Math.max(timeFactor, scoreFactor);
    
    return [
        0.7 - difficulty * 0.4,
        0.2 + difficulty * 0.3,
        0.1 + difficulty * 0.1
    ];
}

function weightedRandom(items, weights) {
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let random = Math.random() * totalWeight;
    
    for (let i = 0; i < items.length; i++) {
        random -= weights[i];
        if (random <= 0) return items[i];
    }
    return items[items.length - 1];
}

// ==================== CREAR ENEMIGO ====================
function createEnemy(type) {
    const config = ENEMY_TYPES[type];
    const enemyGroup = new THREE.Group();
    
    // Usar modelo precargado
    const modelClone = LOADED_MODELS[type].clone();
    
  /*  // Aplicar color específico al clon
    modelClone.traverse((child) => {
        if (child.isMesh && child.material) {
            if (Array.isArray(child.material)) {
                child.material = child.material.map(mat => {
                    const clonedMat = mat.clone();
                    clonedMat.color.setHex(config.color);
                    clonedMat.emissive.setHex(config.color);
                    clonedMat.emissiveIntensity = 0.5;
                    return clonedMat;
                });
            } else {
                child.material = child.material.clone();
                child.material.color.setHex(config.color);
                child.material.emissive.setHex(config.color);
                child.material.emissiveIntensity = 0.5;
            }
        }
    });
    */
    
    enemyGroup.add(modelClone);
    
    // Luz del enemigo
    const enemyLight = new THREE.PointLight(config.color, 2, 20);
    enemyGroup.add(enemyLight);
    
    enemyGroup.userData = {
        type: type,
        health: config.health,
        maxHealth: config.health,
        speed: config.speed,
        points: config.points,
        rotationSpeed: 0.02,
        shootCooldown: config.fireRate,
        lastShot: Math.random() * config.fireRate,
        isEnemy: true,
        size: config.size 
    };
    
    return enemyGroup;
}

function spawnEnemy() {
    if (enemies.length >= ENEMY_LIMIT) return;
    
    const types = ['scout', 'fighter', 'heavy'];
    const weights = calculateEnemyWeights();
    const enemyType = weightedRandom(types, weights);
    
    const enemy = createEnemy(enemyType);
    
    // Posición aleatoria alrededor del jugador
    const distance = 50 + Math.random() * 100;
    const angle = Math.random() * Math.PI * 2;
    const height = (Math.random() - 0.5) * 50;
    
    enemy.position.set(
        spaceship.position.x + Math.cos(angle) * distance,
        spaceship.position.y + height,
        spaceship.position.z + Math.sin(angle) * distance
    );
    
    scene.add(enemy);
    enemies.push(enemy);

    // Crear cuerpo físico
    const radius = (enemy.userData.size || 1) * 0.9;
    const enemyBody = new CANNON.Body({
        mass: 1,
        position: new CANNON.Vec3(enemy.position.x, enemy.position.y, enemy.position.z),
        shape: new CANNON.Sphere(radius),
        linearDamping: 0.9
    });
    
    enemy.userData.body = enemyBody;
    world.addBody(enemyBody);
}

function updateEnemies(delta) {
    enemySpawnTimer += delta;
    if (enemySpawnTimer >= ENEMY_SPAWN_INTERVAL && enemies.length < ENEMY_LIMIT) {
        if (enemies.length < MIN_ENEMIES || Math.random() < 0.7) { 
            spawnEnemy();
        }
        enemySpawnTimer = 0;
    }
    
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        
        // Enemigo mira hacia el jugador
        const enemyPos = enemy.userData.body ? 
            new THREE.Vector3(enemy.userData.body.position.x, enemy.userData.body.position.y, enemy.userData.body.position.z) : 
            enemy.position.clone();
        
        const playerPos = spaceshipBody ? 
            new THREE.Vector3(spaceshipBody.position.x, spaceshipBody.position.y, spaceshipBody.position.z) : 
            spaceship.position.clone();
        
        // Calcular dirección hacia el jugador
        const direction = new THREE.Vector3()
            .subVectors(playerPos, enemyPos)
            .normalize();
        
        // Solo rotar si hay una dirección válida
        if (direction.length() > 0.001) {
            const targetQuat = new THREE.Quaternion();
            targetQuat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
            enemy.quaternion.slerp(targetQuat, 0.005);
        }
        
        const enemyBody = enemy.userData.body;
        if (enemyBody) {
            const dir = new CANNON.Vec3(
                spaceshipBody.position.x - enemyBody.position.x,
                spaceshipBody.position.y - enemyBody.position.y,
                spaceshipBody.position.z - enemyBody.position.z
            );

            const len = dir.length();
            if (len > 0.0001) {
                dir.scale(1 / len, dir);
                const moveSpeed = enemy.userData.speed; 
                enemyBody.velocity.x = dir.x * moveSpeed;
                enemyBody.velocity.y = dir.y * moveSpeed;
                enemyBody.velocity.z = dir.z * moveSpeed;
            } else {
                enemyBody.velocity.set(0, 0, 0);
            }

            enemy.position.set(enemyBody.position.x, enemyBody.position.y, enemyBody.position.z);
        }
        
        // Disparar
        enemy.userData.lastShot += delta;
        if (enemy.userData.lastShot >= enemy.userData.shootCooldown) {
            enemyShoot(enemy);
            enemy.userData.lastShot = 0;
        }
        
        // Verificar colisión con jugador 
        const collisionEnemyPos = enemy.userData.body ? enemy.userData.body.position : enemy.position;
        const collisionShipPos = spaceshipBody ? spaceshipBody.position : spaceship.position;
        const dx = (collisionEnemyPos.x - collisionShipPos.x);
        const dy = (collisionEnemyPos.y - collisionShipPos.y);
        const dz = (collisionEnemyPos.z - collisionShipPos.z);
        const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (distance < 4) {
            damagePlayer(25);
            createExplosion(enemy.position);
            if (enemy.userData.body) world.removeBody(enemy.userData.body);
            scene.remove(enemy);
            enemies.splice(i, 1);
        }
    }
}

// ==================== SISTEMA DE DISPAROS ====================
function shoot() {
    if (!gameActive) return;

    const currentTime = performance.now() / 1000;
    if (currentTime - lastShootTime < shootCooldown) return;
    
    lastShootTime = currentTime;
    
    // Sonido del disparo
    if (shootSound && shootSound.buffer && !shootSound.isPlaying) {
        shootSound.play();
    }

    const projectileGeometry = new THREE.SphereGeometry(0.2, 8, 8);
    const projectileMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        emissive: 0x00ffff,
        emissiveIntensity: 1
    });
    const projectile = new THREE.Mesh(projectileGeometry, projectileMaterial);
    
    let spawnOffset, direction;
    
    if (renderer.xr.isPresenting && controller2) {
        // En VR: disparar
        spawnOffset = new THREE.Vector3(0, 0, -0.1);
        direction = new THREE.Vector3(0, 0, -1);
        
        const controllerWorldPos = new THREE.Vector3();
        const controllerWorldQuat = new THREE.Quaternion();
        controller2.getWorldPosition(controllerWorldPos);
        controller2.getWorldQuaternion(controllerWorldQuat);
        
        spawnOffset.applyQuaternion(controllerWorldQuat);
        direction.applyQuaternion(controllerWorldQuat);
        
        projectile.position.copy(controllerWorldPos).add(spawnOffset);
    } else {
        // En modo normal: disparar desde la nave
        spawnOffset = new THREE.Vector3(0, 0, -3);
        direction = new THREE.Vector3(0, 0, -1);
        
        spawnOffset.applyQuaternion(spaceship.quaternion);
        direction.applyQuaternion(spaceship.quaternion);
        
        projectile.position.copy(spaceship.position).add(spawnOffset);
    }
    
    const projBody = new CANNON.Body({
        mass: 0.05,
        shape: new CANNON.Sphere(0.18),
        position: new CANNON.Vec3(projectile.position.x, projectile.position.y, projectile.position.z),
        linearDamping: 0
    });
    projBody.velocity.set(direction.x * 50, direction.y * 50, direction.z * 50);
    world.addBody(projBody);

    projectile.userData = {
        body: projBody,
        lifetime: 3,
        isPlayerProjectile: true
    };
    
    scene.add(projectile);
    projectiles.push(projectile);
}

function enemyShoot(enemy) {
    // Sonido de disparo enemigo
    if (enemyShootSound && enemyShootSound.buffer && !enemyShootSound.isPlaying) {
        enemyShootSound.play();
    }

    const projectileGeometry = new THREE.SphereGeometry(0.3, 8, 8);
    const projectileMaterial = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        emissive: 0xff0000,
        emissiveIntensity: 1
    });
    const projectile = new THREE.Mesh(projectileGeometry, projectileMaterial);
    
    const spawnPos = enemy.userData.body
        ? new THREE.Vector3(enemy.userData.body.position.x, enemy.userData.body.position.y, enemy.userData.body.position.z)
        : enemy.position.clone();
    projectile.position.copy(spawnPos);
    
    const direction = new THREE.Vector3();
    direction.subVectors(spaceship.position, enemy.position);
    direction.normalize();
    
    const projBody = new CANNON.Body({
        mass: 0.05,
        shape: new CANNON.Sphere(0.25),
        position: new CANNON.Vec3(projectile.position.x, projectile.position.y, projectile.position.z),
        linearDamping: 0
    });
    projBody.velocity.set(direction.x * 30, direction.y * 30, direction.z * 30);
    world.addBody(projBody);

    projectile.userData = {
        body: projBody,
        lifetime: 4,
        isEnemyProjectile: true
    };
    
    scene.add(projectile);
    projectiles.push(projectile);
}

function updateProjectiles(delta) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const proj = projectiles[i];
        
        if (proj.userData && proj.userData.body) {
            proj.position.set(proj.userData.body.position.x, proj.userData.body.position.y, proj.userData.body.position.z);
        }
        
        proj.userData.lifetime -= delta;
        
        if (proj.userData.isPlayerProjectile) {
            for (let j = enemies.length - 1; j >= 0; j--) {
                const enemy = enemies[j];
                const enemyPos = enemy.userData.body ? enemy.userData.body.position : enemy.position;
                const projPos = proj.userData.body ? proj.userData.body.position : proj.position;
                const dx = projPos.x - enemyPos.x;
                const dy = projPos.y - enemyPos.y;
                const dz = projPos.z - enemyPos.z;
                const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
                
                if (distance < 2.5) {
                    enemy.userData.health--;
                    
                    if (proj.userData.body) world.removeBody(proj.userData.body);
                    scene.remove(proj);
                    projectiles.splice(i, 1);
                    
                    if (enemy.userData.health <= 0) {
                        score += enemy.userData.points;
                        createExplosion(enemy.position);
                        if (enemy.userData.body) world.removeBody(enemy.userData.body);
                        scene.remove(enemy);
                        enemies.splice(j, 1);
                    }
                    break;
                }
            }
        } else {
            const projPos = proj.userData.body ? proj.userData.body.position : proj.position;
            const shipPos = spaceshipBody ? spaceshipBody.position : spaceship.position;
            const dx = projPos.x - shipPos.x;
            const dy = projPos.y - shipPos.y;
            const dz = projPos.z - shipPos.z;
            const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
            if (distance < 2.5) {
                damagePlayer(10);
                if (proj.userData.body) world.removeBody(proj.userData.body);
                scene.remove(proj);
                projectiles.splice(i, 1);
            }
        }
        
        if (proj.userData.lifetime <= 0) {
            if (proj.userData.body) world.removeBody(proj.userData.body);
            scene.remove(proj);
            projectiles.splice(i, 1);
        }
    }
}

// ==================== SISTEMA DE DAÑO Y EXPLOSIONES ====================
function damagePlayer(amount) {
    if (!gameActive) return;
    
    shield -= amount;
    
    if (shield <= 0) {
        shield = 0;
        gameOver();
    }
    
    updateShieldBar();
    
    // Feedback visual de daño
    scene.background = new THREE.Color(0x330000);
    setTimeout(() => {
        if (gameActive) {
            scene.background = new THREE.Color(0x000000);
        }
    }, 100);
}

function gameOver() {
    gameActive = false;
    const finalScore = document.getElementById('final-score');
    const survivalTime = document.getElementById('survival-time');
    const gameOverScreen = document.getElementById('game-over');
    
    if (finalScore) finalScore.textContent = score;
    if (survivalTime) survivalTime.textContent = Math.round(gameTime) + 's';
    if (gameOverScreen) gameOverScreen.style.display = 'block';
}

function restartGame() {
    shield = 100;
    score = 0;
    gameTime = 0;
    gameActive = true;
    
    // Limpiar enemigos
    enemies.forEach(enemy => {
        if (enemy.userData && enemy.userData.body) world.removeBody(enemy.userData.body);
        scene.remove(enemy);
    });
    enemies.length = 0;

    // Limpiar proyectiles
    projectiles.forEach(proj => {
        if (proj.userData && proj.userData.body) world.removeBody(proj.userData.body);
        scene.remove(proj);
    });
    projectiles.length = 0;

    // Limpiar explosiones
    explosions.forEach(exp => scene.remove(exp));
    explosions.length = 0;
    
    // Ocultar pantalla de game over
    const gameOverScreen = document.getElementById('game-over');
    if (gameOverScreen) gameOverScreen.style.display = 'none';
    
    // Resetear posición de la nave
    spaceship.position.set(0, 0, 0);
    spaceship.rotation.set(0, 0, 0);
    velocity.set(0, 0, 0);
    if (spaceshipBody) {
        spaceshipBody.position.set(0, 0, 0);
        spaceshipBody.velocity.set(0, 0, 0);
        spaceshipBody.angularVelocity.set(0, 0, 0);
        spaceshipBody.quaternion.set(0, 0, 0, 1);
    }
    
    // Resetear timers
    enemySpawnTimer = 0;
    lastShootTime = 0;
    
    // Spawnear nuevos enemigos
    spawnInitialEnemies();
    updateShieldBar();
}

function createExplosion(position) {
    // Sonido de explosión
    if (explosionSound && explosionSound.buffer && !explosionSound.isPlaying) {
        explosionSound.play();
    }

    const particleCount = 15;
    
    for (let i = 0; i < particleCount; i++) {
        const particleGeometry = new THREE.SphereGeometry(0.2, 4, 4);
        const particleMaterial = new THREE.MeshBasicMaterial({
            color: Math.random() > 0.5 ? 0xff6600 : 0xffff00,
            emissive: 0xff6600,
            emissiveIntensity: 1
        });
        const particle = new THREE.Mesh(particleGeometry, particleMaterial);
        
        particle.position.copy(position);
        
        const velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 15,
            (Math.random() - 0.5) * 15,
            (Math.random() - 0.5) * 15
        );
        
        particle.userData = {
            velocity: velocity,
            lifetime: 0.8
        };
        
        scene.add(particle);
        explosions.push(particle);
    }
    
    const explosionLight = new THREE.PointLight(0xff6600, 8, 30);
    explosionLight.position.copy(position);
    scene.add(explosionLight);
    setTimeout(() => scene.remove(explosionLight), 200);
}

function updateExplosions(delta) {
    for (let i = explosions.length - 1; i >= 0; i--) {
        const particle = explosions[i];
        
        particle.position.add(particle.userData.velocity.clone().multiplyScalar(delta));
        particle.userData.lifetime -= delta;
        
        particle.material.opacity = particle.userData.lifetime * 1.25;
        particle.material.transparent = true;
        
        if (particle.userData.lifetime <= 0) {
            scene.remove(particle);
            explosions.splice(i, 1);
        }
    }
}

// ==================== DETECCIÓN DE GAMEPAD ====================
window.addEventListener("gamepadconnected", (e) => {
    console.log("Gamepad conectado:", e.gamepad);
    gamepadIndex = e.gamepad.index;
});

window.addEventListener("gamepaddisconnected", () => {
    console.log("Gamepad desconectado");
    gamepadIndex = null;
});

function readGamepad() {
    if (gamepadIndex === null) return null;

    const gp = navigator.getGamepads()[gamepadIndex];
    if (!gp) return null;

    return {
        lx: gp.axes[0],
        ly: gp.axes[1],
        rx: gp.axes[2],
        ry: gp.axes[3],
        rt: gp.buttons[7]?.value || 0,
        lt: gp.buttons[6]?.value || 0,
        a: gp.buttons[0]?.pressed || false,
        b: gp.buttons[1]?.pressed || false,
        x: gp.buttons[2]?.pressed || false,
        y: gp.buttons[3]?.pressed || false
    };
}

// ==================== ACTUALIZACIÓN DEL JUEGO ====================
function updateFlight(delta) {
    if (!gameActive) return;
    
    const gp = readGamepad();
    
    // ========== ACELERACIÓN ==========
    if (gp) {
        acceleration = 0;
        
        // Stick izquierdo: Acelerar/Frenar + Girar
        if (gp.ly < -0.2) {
            acceleration = maxAcceleration * (-gp.ly);
        } else if (gp.ly > 0.2) {
            acceleration = -maxAcceleration * (gp.ly) * 0.7;
        }
        
        // Gatillo derecho: Acelerar
        if (gp.rt > 0.1) {
            acceleration = maxAcceleration * gp.rt;
        }
        
        // Gatillo izquierdo: Frenar
        if (gp.lt > 0.1) {
            acceleration = -maxAcceleration * gp.lt * 0.5;
        }
        
        // Stick izquierdo: Girar izquierda/derecha
        if (Math.abs(gp.lx) > 0.1) {
            rotationSpeed.y = -gp.lx * 2;
        } else {
            rotationSpeed.y *= 0.9;
        }
        
        // Stick derecho: Inclinar arriba/abajo
        if (Math.abs(gp.ry) > 0.1) {
            rotationSpeed.x = -gp.ry * 2;
        } else {
            rotationSpeed.x *= 0.9;
        }
        
        // Botón B: Turbo
        turboActive = gp.b;
        
        // Gatillo derecho: Disparar
        if (gp.rt > 0.3) {
            shoot();
        }
        
    } else {
        // Controles de teclado
        if (keys['w']) acceleration = maxAcceleration;
        else if (keys['s']) acceleration = -maxAcceleration * 0.5;
        else acceleration = 0;
        
        if (keys['a']) rotationSpeed.y = 1;
        else if (keys['d']) rotationSpeed.y = -1;
        else rotationSpeed.y *= 0.9;
        
        if (keys['q']) rotationSpeed.x = 1;
        else if (keys['e']) rotationSpeed.x = -1;
        else rotationSpeed.x *= 0.9;
        
        if (keys[' ']) {
            turboActive = true;
            if (!renderer.xr.isPresenting) {
                shoot();
            }
        } else {
            turboActive = false;
        }
    }
    
    const turboMultiplier = turboActive ? 2 : 1;
    
    if (spaceshipBody) {
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(spaceship.quaternion).normalize();
        const fwd = new CANNON.Vec3(forward.x, forward.y, forward.z);

        const dvScalar = -acceleration * turboMultiplier * delta * 60;
        const dv = new CANNON.Vec3(fwd.x * dvScalar, fwd.y * dvScalar, fwd.z * dvScalar);
        spaceshipBody.velocity.vadd(dv, spaceshipBody.velocity);

        spaceshipBody.velocity.scale(friction, spaceshipBody.velocity);

        const speed = spaceshipBody.velocity.length();
        if (speed > maxSpeed * turboMultiplier) {
            spaceshipBody.velocity.scale((maxSpeed * turboMultiplier) / speed, spaceshipBody.velocity);
        }
    }
    
    spaceship.rotation.y += rotationSpeed.y * delta;
    spaceship.rotation.x += rotationSpeed.x * delta;
    
    if (spaceshipBody) {
        spaceship.position.set(spaceshipBody.position.x, spaceshipBody.position.y, spaceshipBody.position.z);
    }
    
    // Regeneración de escudo
    if (shield < 100) {
        shield += delta * 0.3;
        shield = Math.min(100, shield);
        updateShieldBar();
    }
}

function updateShieldBar() {
    const shieldBar = document.getElementById('shield-bar');
    if (!shieldBar) return;
    
    shieldBar.style.width = shield + '%';
    
    if (shield > 70) {
        shieldBar.style.background = 'linear-gradient(90deg, #00ff00, #00ff00)';
    } else if (shield > 30) {
        shieldBar.style.background = 'linear-gradient(90deg, #ffff00, #ffff00)';
    } else {
        shieldBar.style.background = 'linear-gradient(90deg, #ff0000, #ff0000)';
    }
}

function updateHUD() {
    const speed = spaceshipBody ? spaceshipBody.velocity.length() : velocity.length();
    const closestDistance = getClosestEnemyDistance();

    // Actualizar HUD 3D (funciona en ambos modos)
    update3DHUD();
}

// ==================== ACTUALIZAR HUD 3D ====================
function update3DHUD() {
    if (!hudElements.panel1 || !hudElements.panel2 || !hudElements.panel3) return;

    const speed = spaceshipBody ? spaceshipBody.velocity.length() : velocity.length();
    const closestDistance = getClosestEnemyDistance();

    // Actualizar panel 1: Información de Combate 
    updateHUDTexture(
        hudElements.panel1,
        `Enemigos: ${enemies.length}/${ENEMY_LIMIT}\nPuntuación: ${score}\nTiempo: ${Math.round(gameTime)}s`,
        false,
        'left'
    );

    // Actualizar panel 2: Estado de la Nave 
    updateHUDTexture(
        hudElements.panel2,
        `Velocidad: ${speed.toFixed(1)} km/s\nEscudo: ${Math.round(shield)}%\nMás Cercano: ${closestDistance >= 0 ? Math.round(closestDistance) + 'm' : '-'}`,
        false,
        'right'
    );

    // Actualizar panel 3: Radar 
    updateHUDTexture(
        hudElements.panel3,
        '',
        true
    );
}

// ==================== CONTROLES ====================
function onKeyDown(e) {
    keys[e.key.toLowerCase()] = true;
    
    if (e.key === ' ') {
        turboActive = true;
        if (!renderer.xr.isPresenting) {
            shoot();
        }
    }
}

function onKeyUp(e) {
    keys[e.key.toLowerCase()] = false;
    
    if (e.key === ' ') {
        turboActive = false;
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ==================== ACTIVACIÓN DE AUDIO ====================
const unlockButton = document.getElementById('unlockAudioButton');

if (unlockButton) {
    unlockButton.addEventListener('click', async () => {
        try {
            // Crear y reproducir un buffer vacío para desbloquear audio
            const context = new (window.AudioContext || window.webkitAudioContext)();
            const buffer = context.createBuffer(1, 1, 22050);
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(context.destination);
            source.start();
            
            // Iniciar audio ambiente si está disponible
            if (ambientSound && ambientSound.buffer) {
                ambientSound.play();
            }
            
            unlockButton.style.display = 'none';
            console.log('Audio activado');
        } catch (error) {
            console.error('Error activando audio:', error);
        }
    });
}

const clock = new THREE.Clock();

function animate() {
    renderer.setAnimationLoop(function() {
        const delta = Math.min(clock.getDelta(), 0.1);
        
        if (world) world.step(1/60, delta, 3);

        if (gameActive) {
            gameTime += delta;
            
            updateFlight(delta);
            updateEnemies(delta);
            updateProjectiles(delta);
            updateExplosions(delta);
            updateHUD();
        }

        renderer.render(scene, camera);
    });
}

// Inicializar el juego
init().then(() => {
    animate();
});
