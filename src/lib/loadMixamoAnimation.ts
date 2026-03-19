import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { mixamoVRMRigMap } from "./mixamoVRMRigMap";

export async function loadMixamoAnimation(url: string, vrm: VRM) {
	const loader = new FBXLoader();
	return loader.loadAsync(url).then((asset) => {
		const clip = THREE.AnimationClip.findByName(asset.animations, "mixamo.com");
		const tracks: THREE.QuaternionKeyframeTrack[] = [];
		const restRotationInverse = new THREE.Quaternion();
		const parentRestWorldRotation = new THREE.Quaternion();
		const quatA = new THREE.Quaternion();

		const hips = asset.getObjectByName("mixamorigHips");
		const normalized = vrm.humanoid.normalizedRestPose.hips;

		if (!hips || !normalized?.position || !clip) {
			throw new Error("Invalid model");
		}

		const motionHipsHeight = hips.position.y;
		const vrmHipsHeight = normalized.position[1];
		const hipsPositionScale = vrmHipsHeight / motionHipsHeight;

		clip.tracks.forEach((track) => {
			const trackSplitted = track.name.split(".");
			const mixamoRigName = trackSplitted[0] as keyof typeof mixamoVRMRigMap;
			const vrmBoneName = mixamoVRMRigMap[mixamoRigName] as VRMHumanBoneName;
			const vrmNodeName =
				vrm.humanoid?.getNormalizedBoneNode(vrmBoneName)?.name;
			const mixamoRigNode = asset.getObjectByName(mixamoRigName);

			if (vrmNodeName && mixamoRigNode?.parent) {
				const propertyName = trackSplitted[1];

				mixamoRigNode.getWorldQuaternion(restRotationInverse).invert();
				mixamoRigNode.parent.getWorldQuaternion(parentRestWorldRotation);

				if (track instanceof THREE.QuaternionKeyframeTrack) {
					for (let i = 0; i < track.values.length; i += 4) {
						const flatQuaternion = track.values.slice(i, i + 4);

						quatA.fromArray(flatQuaternion);

						quatA
							.premultiply(parentRestWorldRotation)
							.multiply(restRotationInverse);

						quatA.toArray(flatQuaternion);

						flatQuaternion.forEach((v, index) => {
							track.values[index + i] = v;
						});
					}

					tracks.push(
						new THREE.QuaternionKeyframeTrack(
							`${vrmNodeName}.${propertyName}`,
							track.times,
							track.values.map((v, i) =>
								vrm.meta?.metaVersion === "0" && i % 2 === 0 ? -v : v,
							),
						),
					);
				} else if (track instanceof THREE.VectorKeyframeTrack) {
					const value = track.values.map(
						(v, i) =>
							(vrm.meta?.metaVersion === "0" && i % 3 !== 1 ? -v : v) *
							hipsPositionScale,
					);
					tracks.push(
						new THREE.VectorKeyframeTrack(
							`${vrmNodeName}.${propertyName}`,
							track.times,
							value,
						),
					);
				}
			}
		});

		return new THREE.AnimationClip("vrmAnimation", clip.duration, tracks);
	});
}
