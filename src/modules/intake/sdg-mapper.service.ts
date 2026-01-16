// apps/backend/src/modules/intake/sdg-mapper.service.ts
import { PostWin, SDG_TARGETS } from "@posta/core";

export class SDGMapperService {
  private readonly KEYWORD_MAP = {
    SDG_4: ['school', 'education', 'fees', 'learning', 'teacher', 'student', 'enrolment', 'literacy', 'uniform'],
    SDG_5: ['gender', 'equality', 'woman', 'girl', 'empowerment', 'rights', 'bias']
  };

  /**
   * Section A.3: Initial Goal Assignment
   * Used during handleIntake to set the primary SDG categories.
   */
  public mapMessageToGoals(message: string): ('SDG_4' | 'SDG_5')[] {
    const text = message.toLowerCase();
    const goals: ('SDG_4' | 'SDG_5')[] = [];

    if (this.KEYWORD_MAP.SDG_4.some(k => text.includes(k))) goals.push('SDG_4');
    if (this.KEYWORD_MAP.SDG_5.some(k => text.includes(k))) goals.push('SDG_5');

    // Default to SDG_4 per JourneyService dependency
    return goals.length > 0 ? goals : ['SDG_4'];
  }

  /**
   * Section O.1: Automatically tags PostWins for institutional reporting
   * Maps content to specific SDG 4 and SDG 5 sub-targets.
   */
  public async mapImpact(postWin: PostWin): Promise<string[]> {
    const tags: string[] = [];
    const text = postWin.description.toLowerCase();

    // Mapping to SDG 4 Sub-Targets via [Posta Core Constants](url)
    if (text.includes('school') || text.includes('uniform')) {
      tags.push(SDG_TARGETS.SDG_4.PRIMARY);
    }
    if (text.includes('read') || text.includes('write') || text.includes('literacy')) {
      tags.push(SDG_TARGETS.SDG_4.LITERACY);
    }

    // Mapping to SDG 5 Sub-Targets
    if (text.includes('girl') || text.includes('woman') || text.includes('empowerment')) {
      tags.push(SDG_TARGETS.SDG_5.EMPOWERMENT);
    }

    return tags;
  }
}
