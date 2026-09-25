import { AchievementManager,type AchievementProvider } from "../game/Achievements.js";
import { NarrativeDirector } from "../narrative/NarrativeDirector.js";
import { CodexManager } from "../content/Codex.js";
import { EntitlementManager,type EntitlementState } from "../release/Entitlements.js";
import { CreditsRegistry } from "../release/Credits.js";
import { PhotoModeController } from "../photo/PhotoMode.js";
import { InputGlyphRegistry } from "../input/InputGlyphs.js";
import { CheckpointManager,type CheckpointSnapshot } from "../modules/checkpoints/CheckpointManager.js";
import { SubtitlePlayer } from "../presentation/Subtitles.js";
import { VoiceManifest } from "../presentation/VoiceManifest.js";
import { CinematicDirector } from "../presentation/Cinematics.js";
import { NotificationCenter } from "../presentation/Notifications.js";
import { TransitionManager } from "../presentation/Transitions.js";
import { CaptureService,type CaptureAdapter } from "../presentation/Capture.js";
import { OnboardingManager,type OnboardingState } from "../onboarding/OnboardingManager.js";

export interface ProductionServicesOptions {
  achievementProvider?:AchievementProvider;
  entitlement?:EntitlementState;
  captureAdapter?:CaptureAdapter;
}

export interface ProductionStateV1{
  schemaVersion:1;
  achievements:{unlocked:string[]};
  codex:{unlocked:string[];read:string[]};
  onboarding:OnboardingState;
  checkpoints:CheckpointSnapshot<unknown>;
}
export type ProductionState=ProductionStateV1;

/** High-level game production services that are deliberately renderer-neutral.
 * Individual games may ignore any service they do not need. */
export class ProductionServices {
  readonly achievements:AchievementManager;
  readonly narrative=new NarrativeDirector();
  readonly codex=new CodexManager();
  readonly entitlements:EntitlementManager;
  readonly credits=new CreditsRegistry();
  readonly photo=new PhotoModeController();
  readonly glyphs=new InputGlyphRegistry();
  readonly checkpoints=new CheckpointManager<unknown>();
  readonly subtitles=new SubtitlePlayer();
  readonly voice=new VoiceManifest();
  readonly cinematics=new CinematicDirector();
  readonly notifications=new NotificationCenter();
  readonly transitions=new TransitionManager();
  readonly onboarding=new OnboardingManager();
  readonly capture:CaptureService;

  constructor(options:ProductionServicesOptions={}){
    this.achievements=new AchievementManager(options.achievementProvider);
    this.entitlements=new EntitlementManager(options.entitlement??"full");
    this.capture=new CaptureService(options.captureAdapter);
  }

  /** Durable shell-owned state only. Transient presentation state and platform-derived entitlements are intentionally excluded. */
  snapshotState():ProductionState{
    return{
      schemaVersion:1,
      achievements:this.achievements.snapshot(),
      codex:this.codex.snapshot(),
      onboarding:this.onboarding.snapshot(),
      checkpoints:this.checkpoints.snapshot()
    };
  }

  hydrateState(state:Partial<ProductionState>|null|undefined):void{
    if(!state)return;
    if(state.schemaVersion!==undefined&&state.schemaVersion!==1)throw new Error(`Unsupported production state schema: ${state.schemaVersion}`);
    this.achievements.hydrate(state.achievements??{});
    this.codex.hydrate(state.codex??{});
    this.onboarding.hydrate(state.onboarding??{});
    this.checkpoints.hydrate(state.checkpoints??{});
  }
}
