import { type VRM, VRMLoaderPlugin } from "@pixiv/three-vrm";
import * as JoyCon from "joy-con-webhid";
import { type Component, onMount } from "solid-js";
import {
	AmbientLight,
	AnimationMixer,
	BackSide,
	BoxGeometry,
	DirectionalLight,
	LoopRepeat,
	Mesh,
	MeshStandardMaterial,
	NoToneMapping,
	PerspectiveCamera,
	Scene,
	SRGBColorSpace,
	Timer,
	WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/Addons.js";
import { loadMixamoAnimation } from "./lib/loadMixamoAnimation";

const App: Component = () => {
	let mixer: AnimationMixer;
	let vrm: VRM;
	let currentValue: number | null = null;
	const alpha = 0.9;

	onMount(async () => {
		const scene = new Scene();
		const camera = new PerspectiveCamera(
			75,
			window.innerWidth / window.innerHeight,
			0.1,
			1000,
		);
		camera.position.set(0, -0.5, 1.3);
		const timer = new Timer();

		const renderer = new WebGLRenderer({ antialias: true });
		renderer.setSize(window.innerWidth, window.innerHeight);
		renderer.setPixelRatio(window.devicePixelRatio);
		renderer.shadowMap.enabled = true;
		renderer.outputColorSpace = SRGBColorSpace;
		renderer.toneMapping = NoToneMapping;
		renderer.toneMappingExposure = 1.0;

		document.body.appendChild(renderer.domElement);

		const light = new AmbientLight(0xffffff, 2.0);
		scene.add(light);
		const dirLight = new DirectionalLight(0xffffff, 1.0);
		dirLight.position.set(2, 4, 2);
		dirLight.castShadow = true;
		scene.add(dirLight);

		const box = new Mesh(
			new BoxGeometry(3, 3, 3),
			new MeshStandardMaterial({ color: 0xffffff, side: BackSide }),
		);
		box.receiveShadow = true;
		scene.add(box);

		const loader = new GLTFLoader();
		loader.register((p) => new VRMLoaderPlugin(p));
		const gltf = await loader.loadAsync("/models/polka.vrm");
		vrm = gltf.userData.vrm;
		vrm.scene.traverse((obj) => {
			obj.castShadow = true;
		});
		scene.add(vrm.scene);
		vrm.scene.rotation.y = Math.PI;
		vrm.scene.position.set(0, -1.5, 0);

		const idle = await loadMixamoAnimation("/models/animations/Idle.fbx", vrm);
		mixer = new AnimationMixer(vrm.scene);
		const clip = mixer.clipAction(idle);
		clip.setLoop(LoopRepeat, Infinity);
		clip.play();

		async function animate() {
			timer.update();
			const delta = timer.getDelta();
			if (vrm) vrm.update(delta);
			if (mixer) mixer.update(delta);
			renderer.render(scene, camera);
		}
		renderer.setAnimationLoop(animate);
	});

	const startTracking = async () => {
		await JoyCon.connectJoyCon();
		setInterval(async () => {
			for (const joyCon of JoyCon.connectedJoyCons.values()) {
				if (joyCon.eventListenerAttached) continue;
				await joyCon.open();
				await joyCon.enableStandardFullMode();
				await joyCon.enableIMUMode();
				await joyCon.enableVibration();
				// @ts-expect-error
				joyCon.addEventListener("hidinput", ({ detail }) => {
					const norm = Math.sqrt(
						detail.accelerometers[2].x.acc ** 2 +
							detail.accelerometers[2].y.acc ** 2 +
							detail.accelerometers[2].z.acc ** 2,
					);
					if (currentValue === null) {
						currentValue = norm;
						return;
					}
					currentValue = alpha * currentValue + (1 - alpha) * norm;
					if (currentValue < 0.6) console.log("up");
				});
				joyCon.eventListenerAttached = true;
			}
		}, 2000);
	};

	return (
		<button
			type="button"
			style={{ position: "absolute" }}
			onclick={startTracking}
		>
			Start Tracking
		</button>
	);
};

export default App;
