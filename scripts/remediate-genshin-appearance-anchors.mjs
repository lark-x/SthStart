/**
 * Replace the shared Genshin appearance placeholder with structured visual
 * anchors.  The Akasha MCP catalog is the identity/source index; its text
 * corpus does not expose a complete structured hair/eye/outfit field for
 * every character, so design-derived entries are explicitly marked as
 * unconfirmed and incomplete entries are left honest instead of invented.
 *
 * Usage:
 *   node scripts/remediate-genshin-appearance-anchors.mjs --dry-run
 *   node scripts/remediate-genshin-appearance-anchors.mjs
 */

import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const envPath = resolve(root, '.env');
const catalogPath = resolve(root, 'scripts/akasha-genshin-character-catalog.json');

function readEnv() {
  if (!existsSync(envPath)) return {};
  return Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2].trim()]),
  );
}

const env = { ...readEnv(), ...process.env };
const dbPath = resolve(root, env.STHSTART_DATABASE_PATH || './data/sthstart.db');
const catalogPayload = JSON.parse(readFileSync(catalogPath, 'utf8'));
const catalog = Array.isArray(catalogPayload.characters) ? catalogPayload.characters : [];
const catalogByName = new Map(catalog.map((character) => [character.name, character]));

const clone = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const unique = (values) => [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];

function appearance(description, hair, eyes, build, outfit, accessories, confidence = 'design-derived') {
  return {
    description,
    hair,
    eyes,
    build,
    outfits: [outfit],
    accessories,
    stableFeatures: unique([hair, eyes, ...accessories]),
    sourceConfidence: confidence,
  };
}

// These are compact visual anchors rather than long prose prompts.  They are
// intentionally separated into fields so image prompt compilation can use
// only the parts it needs and the editor can correct one fact at a time.
const appearanceByName = {
  琴: appearance('金发蓝眼的高挑女性，长发束成低马尾；西风骑士团的白蓝制服与披风让她显得端正克制。', '金色长发，束成低马尾，额前留有整齐碎发', '蓝色眼睛，沉静专注', '高挑匀称，站姿挺拔', '白蓝色西风骑士团制服、短裙与披风，配长靴和手套', ['西风骑士团徽记', '腰间长剑']),
  丽莎: appearance('紫发绿眼的成熟女性，气质慵懒而优雅；宽檐魔女帽、紫色法袍和金色饰边是她的稳定识别点。', '深紫色长发，自然披落至背部', '绿色眼睛，目光慵懒', '高挑丰满，动作从容', '紫色法师长裙与白色内衬，金色饰边和高跟靴', ['紫色宽檐魔女帽', '雷元素神之眼', '金色胸针']),
  芭芭拉: appearance('金发蓝眼的少女偶像，双马尾和蓝白色舞台服让她显得明亮亲和；整体轮廓轻快、干净。', '金色长发，分成两束高双马尾', '明亮的蓝色眼睛', '娇小匀称，动作轻盈', '蓝白色偶像礼服，短裙、白色袜子与蓝色鞋靴', ['蓝色发带', '西风教会十字饰物', '水元素神之眼']),
  凯亚: appearance('深蓝发、棕肤的高挑男性，右眼佩戴眼罩；蓝白骑兵礼服、白色毛领和金色装饰形成鲜明轮廓。', '深蓝色中长发，侧分并遮住部分额头', '蓝色眼睛，右眼由眼罩遮盖', '高挑修长，姿态潇洒', '蓝白色西风骑兵长衣，白色毛领、金色肩饰与长靴', ['黑色眼罩', '蓝色耳坠', '腰间佩剑']),
  迪卢克: appearance('红发红眼的高挑男性，长发束成马尾；黑红色修身长衣和白色衬衣构成利落、沉重的夜行轮廓。', '深红色长发，束成高马尾垂至背部', '深红色眼睛', '高挑结实，肩背挺直', '黑红色修身长衣、白色衬衣、黑色长裤与靴子', ['黑色手套', '火元素神之眼', '大剑']),
  雷泽: appearance('灰白乱发、红金色眼睛的少年，身形修长而带有野性；暗色皮革与毛皮装备突出狼群与荒野气质。', '灰白色蓬松短发，发梢凌乱', '红金色眼睛，警觉锐利', '修长敏捷，肌肉线条紧实', '深色皮革与毛皮组成的荒野战斗装，露出部分手臂', ['狼爪形护具', '皮革腰带', '双手大剑']),
  安柏: appearance('棕发红眼的少女，长发束成高马尾；红白侦察骑士制服、兔耳发饰与护目镜带来鲜明的冒险家轮廓。', '棕色长发，高高束成马尾', '红棕色眼睛', '轻盈灵活，少女体态', '红白色西风侦察骑士服、短裤、长靴与披肩', ['兔耳形发饰', '护目镜', '火元素神之眼']),
  温迪: appearance('看上去像少年，深青色麻花辫、绿松石色眼睛和绿色吟游诗人服装共同构成轻盈如风的形象。', '深青色麻花辫，辫尾绑有金色发绳', '绿松石色眼睛', '纤细少年身形，动作轻盈', '深绿色吟游诗人短外套、白衬衫、短裤与长袜', ['宽边绿色圆帽和羽毛', '蔓草竖琴']),
  香菱: appearance('蓝黑发、金色眼睛的活泼少女，双丸子发髻和红黄厨师服是她的辨识点；身边常有锅巴跟随。', '蓝黑色长发，扎成两枚圆润发髻', '金黄色眼睛', '娇小灵活，动作快而有力', '红黄色中式厨师短装、围裙、短裤与高筒靴', ['厨师围裙', '锅巴', '长柄武器']),
  北斗: appearance('黑发红眼的高挑女性，长发披肩并带有侧分刘海；黑红金海盗式服装与眼罩强化了豪迈的船长气质。', '黑色长发，披落至背部，侧分刘海', '暗红色眼睛', '高挑强健，肩背有力量感', '黑红金配色的璃月船长服，露肩设计、长靴与披风', ['眼罩', '金色耳饰', '雷元素神之眼']),
  行秋: appearance('蓝发蓝眼的少年，短发侧分；蓝金相间的璃月礼服、白色短裤和长靴让他兼具书生与剑客气质。', '深蓝色短发，侧分并略向外翘', '蓝色眼睛', '纤细少年身形，动作敏捷', '蓝金色璃月短外套、白色短裤、长袜与靴子', ['金色发饰', '书册', '单手剑']),
  凝光: appearance('银白长发、深红眼睛的高挑女性；黑白金配色的修身礼服、长袖与宝石饰物展现出端庄的璃月权贵气质。', '银白色长发，盘成高髻并垂下长束', '深红色眼睛', '高挑修长，仪态端庄', '黑白金配色的修身璃月长裙，高开衩与长袖设计', ['金色发簪', '宝石耳坠', '浮空法器']),
  可莉: appearance('圆润娇小的幼女，橘红短发与红色眼睛十分醒目；红色连衣裙、白袜和大耳朵帽构成她的火花骑士形象。', '橘红色短发，梳成两个俏皮小辫', '红宝石色圆眼睛', '小巧圆润的幼女身形，走路喜欢蹦跳', '大红色短款连衣裙、白色袜子与红色系带鞋', ['圆顶大耳朵帽', '背在身后的炸弹袋']),
  菲谢尔: appearance('金发绿眼的少女，侧马尾与右眼眼罩极具辨识度；黑紫色哥特礼服和夜鸦奥兹构成断罪皇女的轮廓。', '金色长发，扎成侧马尾，发梢带卷', '绿色眼睛，右眼由眼罩遮盖', '纤细少女身形，姿态带戏剧感', '黑紫色哥特风礼服、蕾丝袖口、长袜与靴子', ['右眼眼罩', '紫黑色蝴蝶结', '夜鸦奥兹']),
  班尼特: appearance('灰白乱发、绿色眼睛的少年冒险家，脸上常带开朗神情；轻便的短装、护目镜和绷带体现他的探险装备。', '灰白色短发，蓬松凌乱', '绿色眼睛', '精瘦灵活，四肢有训练痕迹', '白蓝色无袖冒险服、短裤、护膝与长靴', ['额头护目镜', '手臂绷带', '冒险家腰包']),
  诺艾尔: appearance('银白短发、红色眼睛的少女，身形娇小却姿态认真；白红配色的女仆铠甲兼顾裙装与防护轮廓。', '银白色短发，齐肩内扣', '红色眼睛', '娇小匀称，姿态端正', '白红色女仆裙装与轻型铠甲，配护腕、长袜和靴子', ['红色发带', '西风骑士团徽章', '双手剑']),
  七七: appearance('外表年幼、肤色苍白的僵尸少女，淡紫色长发与紫色眼睛安静而清冷；蓝白道袍和额前符箓是核心识别点。', '淡紫色长发，侧束成低马尾', '紫色眼睛，神情平静', '矮小幼女身形，动作缓慢', '蓝白色中式道袍、短裙与白袜', ['额前黄色符箓', '蓝色道士帽', '冰元素神之眼']),
  重云: appearance('浅蓝短发、蓝色眼睛的少年，气质清爽克制；蓝白金配色的驱邪服装和长柄大剑构成规整轮廓。', '浅蓝色短发，发梢向外翘', '蓝色眼睛', '修长少年身形，站姿端正', '蓝白金配色的璃月驱邪服，长袖、腰封与长靴', ['红色绳结', '驱邪符纸', '双手剑']),
  莫娜: appearance('深紫蓝长发、绿色眼睛的年轻占星术士；贴身深蓝占星服、斗篷和大帽子形成星空般的视觉主题。', '深紫蓝色长发，分成两束长双马尾', '绿色眼睛', '纤细修长，动作流畅', '深蓝紫色占星术连体服，星纹披肩、长袜与靴子', ['宽檐占星帽', '星盘', '水元素神之眼']),
  刻晴: appearance('紫发紫眼的少女，双侧发束像猫耳般上扬；紫色璃月短裙、白色长袖和金色饰物体现迅捷利落的气质。', '紫色长发，双侧束起并向上翘成猫耳轮廓', '紫色眼睛', '纤细敏捷，姿态利落', '紫白色璃月短裙与长袖上衣，金色腰饰和高筒靴', ['金色发簪', '雷元素神之眼', '单手剑']),
  砂糖: appearance('薄荷绿短发、青绿色眼睛的娇小少女，戴圆框眼镜；白蓝色炼金术服装与长耳形发束显得清新理工。', '薄荷绿色短发，发梢蓬松，耳侧发束向外', '青绿色眼睛，佩戴圆框眼镜', '娇小纤细，动作谨慎', '白蓝色炼金术师外套、短裙、长袜与靴子', ['圆框眼镜', '炼金术腰包', '风元素神之眼']),
  达达利亚: appearance('橙红短发、蓝色眼睛的青年，身形高挑结实；愚人众灰黑制服、红色围巾和面具配件呈现出战斗者轮廓。', '橙红色短发，发梢向外翘', '蓝色眼睛', '高挑结实，肩背宽阔', '灰黑色愚人众战斗制服、红色围巾、手套与长靴', ['愚人众面具', '水元素神之眼', '弓']),
  迪奥娜: appearance('粉色短发、青绿色眼睛的猫耳少女；蓝粉色调的调酒师制服、猫耳和尾巴是不可替代的识别特征。', '粉色短发，发尾蓬松', '青绿色眼睛', '娇小灵活，带有猫科动作感', '蓝白粉色调的猫尾酒馆调酒服、短裙与长袜', ['猫耳与猫尾', '调酒壶', '冰元素神之眼']),
  钟离: appearance('高挑清隽的男性，深棕长发以发冠束起，金色眼睛沉静如琥珀；墨色礼服与金色岩纹体现端雅厚重。', '深棕色长发，以发冠束起并垂至肩背', '金色眼睛，深邃平静', '高挑匀称，姿态挺拔', '深墨色修身长外套、白色立领内衬、金色岩纹与长靴', ['金色发冠', '颈间金色领饰', '玉石坠饰']),
  辛焱: appearance('深色蓬松长发带红色挑染，红色眼睛锐利明亮；黑红皮革、铆钉和摇滚乐器构成强烈的舞台轮廓。', '黑色蓬松长发，带红色挑染与高马尾', '红色眼睛', '修长结实，动作有爆发力', '黑红色摇滚演出服、皮革短裙、护腕与长靴', ['摇滚电吉他', '铆钉护腕', '火元素神之眼']),
  阿贝多: appearance('浅金短发、青绿色眼睛的青年，气质清洁理性；白蓝色炼金术骑士服和金色细节形成简洁的实验者轮廓。', '浅金色短发，侧分整齐', '青绿色眼睛', '修长匀称，姿态安静', '白蓝色西风炼金术士制服、黑色内衬、手套与长靴', ['金色炼金术徽记', '绘画工具', '岩元素神之眼']),
  甘雨: appearance('蓝紫长发、淡紫眼睛的清冷女性；额前的仙角发饰、蓝白色秘书礼服与金色腰饰体现半仙身份。', '蓝紫色长发，侧束并垂至腰间，额前有细碎呆毛', '淡紫色眼睛', '纤细匀称，气质清冷', '蓝白色璃月秘书礼服、金色腰带与白色薄纱', ['一对淡蓝色仙角发饰', '蓝色宝石耳坠', '冰元素神之眼']),
  魈: appearance('青绿色短发、金色眼睛的少年，身形纤细却带有强烈的战斗张力；白青黑红配色服装与护腕对应夜叉身份。', '青绿色短发，发梢凌乱并有一束上翘', '金色眼睛，锐利警觉', '纤细修长，肌肉紧实', '白青黑红配色的夜叉战斗服、护腕与长靴', ['绿色耳坠', '夜叉面具', '长柄武器']),
  胡桃: appearance('娇小玲珑的少女，深棕长发及腰且发尾卷曲；黑色梅花礼帽、黑红中式丧葬服与橘红眼睛共同构成她的鲜明轮廓。', '及腰的深棕色长发，发尾自然蓬松卷曲', '橘红色渐变眼睛，眼神灵动', '娇小纤细，动作轻盈', '深色中式传统长衫，黑红配色、蝴蝶与梅花纹样', ['绣有梅花印记的黑色圆顶礼帽', '红色流苏饰品', '火元素神之眼']),
  罗莎莉亚: appearance('酒红色长发、淡紫眼睛的高挑女性；黑色修女服、红白头饰和长靴让她呈现冷峻利落的夜行气质。', '酒红色长发，侧分并束成低马尾', '淡紫色眼睛', '高挑修长，动作干练', '黑红色修女战斗服、白色领口、长袜与长靴', ['红白色修女头饰', '冰元素神之眼', '长柄武器']),
  烟绯: appearance('粉红长发、绿色眼睛的少女，额侧有红色角状饰物；红白法袍、帽饰和金色纹样构成璃月律法顾问的轮廓。', '粉红色长发，发尾带深色渐变，侧束成低马尾', '绿色眼睛', '娇小匀称，动作轻快', '红白色璃月法袍、短裙、黑色长袜与高跟鞋', ['红色角状发饰', '宽檐帽', '法器']),
  优菈: appearance('浅蓝长发、蓝色眼睛的高挑女性，长发束成侧马尾；白蓝骑士礼服、披肩和冰纹饰物显得冷峻优雅。', '浅蓝色长发，束成侧马尾并垂至腰间', '蓝色眼睛', '高挑修长，姿态挺拔', '白蓝色西风骑士礼服、披肩、短裙与长靴', ['蓝色发饰', '家族纹章', '双手剑']),
  枫原万叶: appearance('白灰短发带红色挑染、赤红眼睛的少年；黑红白配色的浪人服、枫叶纹样和轻便护具突出漂泊剑客气质。', '白灰色短发，发尾带红色挑染', '赤红色眼睛', '纤细轻盈，动作如风', '黑红白配色的稻妻浪人服、短裤、护腿与披肩', ['枫叶发饰', '红色腰绳', '单手剑']),
  神里绫华: appearance('淡蓝长发、浅蓝眼睛的少女，长发束成侧马尾；蓝白金配色的和服礼装、扇子与发簪体现端庄气质。', '淡蓝色长发，束成侧马尾，发梢微卷', '浅蓝色眼睛', '纤细端正，步态优雅', '蓝白金配色的稻妻和服礼装、短裙与长袜', ['白色花形发簪', '折扇', '冰元素神之眼']),
  宵宫: appearance('活力四射的少女，金橘渐变马尾、红色眼睛和红白烟火师服装极具辨识度；动作充满阳光感。', '金橘渐变马尾，高高扎起，发尾有红色发绳', '红色眼睛，明亮灼热', '娇俏灵活，动作有活力', '红白色烟火师祭典服、短裤、木屐与烟火纹样', ['发尾红色发绳与小金铃', '手腕细绳', '弓']),
  早柚: appearance('个子娇小的忍者少女，浅棕发藏在狸猫兜帽下；棕橙色忍装和圆润兜帽让她像一团会移动的软绵绵。', '浅棕色短发，部分藏在兜帽中', '金棕色眼睛', '娇小幼女身形，动作灵活', '棕橙色狸猫忍装、宽松袖口、短靴与兜帽', ['狸猫耳兜帽', '忍者卷轴', '风元素神之眼']),
  雷电将军: appearance('高挑挺拔的女性，深紫色长发如瀑，深紫眼睛沉静锐利；深紫色和风礼装、金色雷纹与长刀体现将军气场。', '深紫色光滑长发，垂落至腰间', '深紫色眼睛，沉静锐利', '高挑匀称，姿态挺拔', '深紫色宫廷和风长袍、白色内衬、多层裙摆与金色雷纹', ['金色雷纹发饰', '腰间霞纹长刀', '雷元素神之眼']),
  九条裟罗: appearance('深蓝长发、金色眼睛的高挑女性，背后有天狗羽翼；黑白红的天领奉行战装与弓箭形成严整轮廓。', '深蓝色长发，束成高马尾', '金色眼睛', '高挑挺拔，行动迅疾', '黑白红配色的天领奉行战装、护肩、短裙与长靴', ['天狗羽翼', '额前护具', '弓']),
  埃洛伊: appearance('赤红长发、绿色眼睛的年轻猎手，发辫垂在肩侧；皮革、毛皮和金属护具组成实用的荒野猎装。', '赤红色长发，编成侧辫并垂至肩背', '绿色眼睛', '精悍敏捷，肌肉线条清晰', '棕红色皮革猎装、毛皮肩饰、护腕与长靴', ['毛皮护肩', '猎弓', '冰元素神之眼']),
  珊瑚宫心海: appearance('粉色长发、蓝色眼睛的少女，长发分成柔顺双束；白蓝色巫女礼装、珊瑚与珍珠元素呈现海祇岛气质。', '浅粉色长发，分成两束长马尾', '蓝色眼睛', '纤细柔和，姿态端庄', '白蓝色海祇岛巫女礼装、短裙、白色长袜与水纹饰边', ['珊瑚形发饰', '珍珠耳饰', '法器']),
  托马: appearance('金发绿眼的青年，侧分短发利落；红黑白配色的家政武者服装、围裙和护腕兼具亲和与战斗感。', '金色短发，侧分并略向后梳', '绿色眼睛', '高挑结实，动作利落', '红黑白配色的稻妻家政服、围裙、护腕与长靴', ['耳坠', '家政工具包', '长柄武器']),
  五郎: appearance('金橙发、青绿色眼睛的少年，头顶犬耳并有犬尾；棕金色军装与护甲强调忠诚、敏捷的军犬气质。', '金橙色中长发，发尾蓬松', '青绿色眼睛', '娇小精悍，动作敏捷', '棕金色海祇军装、护肩、短裤与长靴', ['犬耳与犬尾', '军用护目镜', '弓']),
  荒泷一斗: appearance('白发红眼、额生红色鬼角的高大男性，体格强健；黑红白鬼族战装和粗犷护甲构成醒目轮廓。', '白色长发，发束凌乱并垂至背部', '红色眼睛', '高大强壮，肌肉明显', '黑红白配色的鬼族战斗装、护甲、腰带与长靴', ['红色鬼角', '鬼族纹饰', '双手剑']),
  申鹤: appearance('银白长发、淡蓝眼睛的高挑女性；白蓝黑配色的修身仙家战装、红色绳结和冰纹呈现清冷气质。', '银白色长发，束成高马尾并垂至腰间', '淡蓝色眼睛', '高挑修长，姿态冷峻', '白蓝黑配色的仙家战装、黑色长袜与高跟靴', ['红色绳结', '黑色发带', '长柄武器']),
  云堇: appearance('深紫长发、紫色眼睛的少女，发髻与戏曲头饰结合；蓝红金色戏服和水袖呈现璃月舞台艺术家的轮廓。', '深紫色长发，盘成双髻并垂下发束', '紫色眼睛', '纤细匀称，姿态优雅', '蓝红金配色的璃月戏服、短裙、水袖与高跟鞋', ['戏曲头饰', '红色面妆元素', '长柄武器']),
  八重神子: appearance('粉色长发、紫色眼睛的高挑女性，额侧有狐耳；白红色鸣神大社巫女服、金色饰物和狐狸元素十分鲜明。', '浅粉色长发，侧束成低马尾', '紫色眼睛', '高挑修长，举止从容', '白红色巫女礼装、短裙、长袜与金色饰边', ['狐狸耳朵', '金色发饰', '雷元素神之眼']),
  神里绫人: appearance('浅蓝长发、蓝色眼睛的高挑男性；白蓝黑配色的家主礼装、手套和金色纹样呈现克制的贵族气质。', '浅蓝色中长发，侧分并束起后发', '蓝色眼睛', '高挑修长，姿态端正', '白蓝黑配色的稻妻家主礼装、披肩、手套与长靴', ['耳坠', '家纹饰物', '单手剑']),
  夜兰: appearance('深蓝长发、金黄色眼睛的成熟女性，举止慵懒而锐利；蓝黑色旗袍式情报服和五色骰子是核心识别点。', '深蓝色长发，自然披落至背部', '金黄色眼睛，慵懒而锐利', '高挑修长，气场从容', '深蓝黑色旗袍式战斗服、白色轻纱、腰封与高跟靴', ['腰间五色骰子', '金色水波纹手环', '弓']),
  久岐忍: appearance('紫色短发、紫红眼睛的女性，部分面容被忍者面罩遮住；紫黑色忍装、绿色腰带和护腕构成实用轮廓。', '紫色短发，发梢齐整', '紫红色眼睛', '修长敏捷，动作干练', '紫黑色忍者服、露腰上衣、绿色腰带与护腿', ['忍者面罩', '绿色护腕', '单手剑']),
  鹿野院平藏: appearance('棕红短发、绿色眼睛的少年，身形轻快；浅棕绿侦探服、护腕与风元素饰物展现自由的武人侦探气质。', '棕红色短发，额前碎发自然垂落', '绿色眼睛', '纤细灵活，动作敏捷', '浅棕绿配色的侦探战装、短裤、护腕与长靴', ['耳坠', '侦探腰包', '法器']),
  柯莱: appearance('深绿长发、绿色眼睛的少女，长发侧束；绿色斗篷、棕色护具和红色围巾构成森林见习巡林员形象。', '深绿色长发，侧束成低马尾', '绿色眼睛', '纤细轻盈，略显拘谨', '绿色短斗篷、棕色护具、短裤与长靴', ['红色围巾', '森林巡林员徽记', '弓']),
  提纳里: appearance('深绿长发、绿色眼睛的少年，头顶硕大狐耳并有狐尾；棕绿巡林员服装和耳饰是稳定辨识点。', '深绿色长发，侧束并垂到胸前', '绿色眼睛', '修长敏捷，姿态警觉', '棕绿配色的巡林员服、短裤、护腕与长靴', ['狐耳与狐尾', '耳侧饰物', '弓']),
  多莉: appearance('紫红短发、金黄色眼睛的娇小商人，身穿紫金色华丽服装；巨大的背包与神灯强化了她的商旅轮廓。', '紫红色短发，发梢蓬松', '金黄色眼睛', '娇小圆润，动作夸张', '紫金色商人礼服、宽袖、短裙与长靴', ['大号商人背包', '神灯', '雷元素神之眼']),
  赛诺: appearance('白发红眼、肤色偏深的高挑男性；沙漠祭司战装、黑金护甲与胡狼头冠构成严肃的审判者形象。', '白色短发，发梢向外', '红色眼睛', '高挑结实，动作精准', '黑白金配色的沙漠祭司战装、护臂与长靴', ['胡狼头冠', '金色肩饰', '长柄武器']),
  坎蒂丝: appearance('深蓝长发、金色眼睛的高挑女性，皮肤偏深；蓝金沙漠守护者装束与大型盾牌构成沉稳的守卫轮廓。', '深蓝色长发，编成侧辫并垂到胸前', '金色眼睛', '高挑健美，姿态稳定', '蓝金配色的沙漠守卫服、披肩、护臂与长裙', ['金色头饰', '大型盾牌', '水元素神之眼']),
  妮露: appearance('红色长发、蓝色眼睛的少女舞者；蓝白红色的轻盈舞衣、金色头饰和水波裙摆形成流动轮廓。', '红色长发，束成两侧长束并垂至腰间', '蓝色眼睛', '纤细柔韧，舞姿轻盈', '蓝白红配色的须弥舞者服、薄纱裙摆与金色饰边', ['金色舞蹈头饰', '水元素神之眼', '水袖装饰']),
  纳西妲: appearance('看起来像七八岁小女孩，浅绿色短发与翠绿色大眼睛清澈明亮；白绿金色的轻盈服装和叶片饰物体现草木气息。', '浅绿色细软短发，发间点缀金色小花', '翠绿色大眼睛', '极为娇小，举止从容', '白色宽松连衣裙、绿色草叶纹样与金色披帛', ['金色花形冠饰', '耳侧绿叶形饰物', '腰间金色腰带']),
  莱依拉: appearance('深蓝长发、浅蓝眼睛的学生，常戴带星纹的睡帽；深蓝金色睡眠学者服与星盘元素带有夜空主题。', '深蓝色长发，侧束成双马尾', '浅蓝色眼睛', '纤细娇小，常显疲惫', '深蓝金色教令院学生服、长裙、披肩与长靴', ['星纹睡帽', '星盘', '冰元素神之眼']),
  流浪者: appearance('靛蓝短发、蓝色眼睛的少年，头戴巨大斗笠；蓝黑色轻甲、飘带和紫色元素形成锋利而飘忽的轮廓。', '靛蓝色短发，发梢蓬松', '蓝色眼睛', '纤细少年身形，动作轻快', '蓝黑色和风短装、轻甲、短裤与长靴', ['巨大斗笠与垂纱', '胸前飘带', '法器']),
  珐露珊: appearance('青绿色长发、青绿色眼睛的成熟女性，戴圆框眼镜；青金色须弥学者服与古代机关饰物体现知性气质。', '青绿色长发，侧束成低马尾', '青绿色眼睛，佩戴圆框眼镜', '高挑修长，举止端庄', '青金色须弥学者服、短裙、长袜与靴子', ['圆框眼镜', '古代机关装置', '弓']),
  瑶瑶: appearance('棕色双髻、金棕色眼睛的幼女，穿着绿黄配色的璃月童装；白玉萝卜精灵月桂常伴身边。', '棕色长发，扎成两枚小发髻', '金棕色眼睛', '娇小幼女身形，动作活泼', '绿黄配色的璃月童装、短裙、袜子与布鞋', ['月桂', '金色发饰', '长柄武器']),
  艾尔海森: appearance('灰绿色短发、青绿色眼睛的高挑男性，服装黑绿相间并带有青色晶体装置；整体轮廓利落理性。', '灰绿色短发，侧分整齐', '青绿色眼睛', '高挑修长，姿态克制', '黑绿配色的教令院书记官战装、轻甲、手套与长靴', ['耳侧的青色装置', '绿色晶体饰件', '双手剑']),
  迪希雅: appearance('黑褐长发带红色挑染、金色眼睛的高大女性，肤色偏深；黑红金沙漠佣兵装与机械护臂突出强悍气质。', '黑褐色长发，带红色挑染并束成高马尾', '金色眼睛', '高大健美，动作有爆发力', '黑红金配色的沙漠佣兵服、护甲、腰带与长靴', ['金属护臂', '金色耳饰', '双手剑']),
  米卡: appearance('浅蓝短发、蓝色眼睛的少年，常戴护目镜；蓝白色西风侦察服、地图和长枪体现测绘员轮廓。', '浅蓝色短发，发梢柔软', '蓝色眼睛', '娇小纤细，动作谨慎', '蓝白色西风侦察服、短裤、护膝与长靴', ['护目镜', '测绘书册', '长柄武器']),
  卡维: appearance('金色长发、红色眼睛的青年，长发侧束；白红金配色的须弥设计师服装与机关箱呈现华丽而讲究的轮廓。', '金色长发，侧束成低马尾', '红色眼睛', '高挑修长，姿态讲究', '白红金配色的须弥建筑师服、长外套、腰带与长靴', ['机关箱梅赫拉克', '金色耳饰', '双手剑']),
  白术: appearance('浅绿色长发、绿色眼睛的清瘦男性，身穿白绿医师长衣；白蛇长生盘在肩颈附近，是最醒目的特征。', '浅绿色长发，束成低马尾', '绿色眼睛', '清瘦修长，姿态温和', '白绿配色的璃月医师长衣、腰带与长靴', ['白蛇长生', '圆框眼镜', '法器']),
  绮良良: appearance('金黄色长发、绿色眼睛的猫妖少女，头顶猫耳并有猫尾；黄绿配色的快递制服与箱子元素体现轻快气质。', '金黄色长发，侧束成双马尾', '绿色眼睛', '娇小灵活，动作像猫一样轻盈', '黄绿配色的稻妻快递制服、短裙与护腿', ['猫耳与猫尾', '快递箱', '草元素神之眼']),
  琳妮特: appearance('蓝灰短发、蓝色眼睛的猫耳少女，气质安静克制；黑白色魔术助手服、尾巴和礼帽装饰构成清晰轮廓。', '蓝灰色短发，发尾微卷', '蓝色眼睛', '纤细娇小，动作安静', '黑白色魔术助手礼服、短裙、长袜与靴子', ['猫耳与猫尾', '黑色领结', '风元素神之眼']),
  林尼: appearance('深紫短发、紫色眼睛的少年魔术师；黑红白配色的燕尾服、礼帽和绶带形成华丽而灵活的舞台轮廓。', '深紫色短发，侧分并略向后梳', '紫色眼睛', '修长轻盈，动作戏剧化', '黑红白配色的魔术燕尾服、短裤、长袜与靴子', ['高顶礼帽', '红色绶带', '火元素神之眼']),
  菲米尼: appearance('浅蓝短发、蓝色眼睛的少年潜水员；深蓝潜水服、金属装置和企鹅玩偶佩伊构成安静的水下作业轮廓。', '浅蓝色短发，发梢柔软', '蓝色眼睛', '纤细少年身形，动作克制', '深蓝色潜水服、白色领巾、护腿与金属装置', ['潜水头盔/护目镜', '企鹅玩偶佩伊', '双手剑']),
  那维莱特: appearance('银白长发、淡蓝眼睛的高挑男性，服装为黑白蓝色的正式长礼服；金色细节和水纹元素显出庄重威仪。', '银白色长发，束成低马尾并垂至背部', '淡蓝色眼睛', '高挑修长，仪态庄严', '黑白蓝色枫丹审判官长礼服、长外套、手套与长靴', ['金色领饰', '水纹饰件', '法器']),
  莱欧斯利: appearance('深灰黑发、红色眼睛的高大男性，服装黑白相间并带金属护具；长外套、手套和拳斗装置强化管理者与拳手气质。', '深灰黑色短发，略带凌乱', '红色眼睛', '高大结实，肩背宽阔', '黑白配色的梅洛彼得堡管理者长衣、背心、手套与长靴', ['金属拳套', '红色领带', '冰元素神之眼']),
  夏洛蒂: appearance('粉色短发、蓝色眼睛的少女记者，戴蓝色记者帽；蓝白色枫丹制服、相机和红色配件形成轻快的新闻工作者轮廓。', '浅粉色短发，齐肩内扣', '蓝色眼睛', '娇小灵活，动作迅速', '蓝白色枫丹记者制服、短裙、长袜与靴子', ['蓝色记者帽', '相机', '冰元素神之眼']),
  芙宁娜: appearance('蓝白双色长发的纤细少女，头戴蓝色宽檐礼帽；蓝白色宫廷礼服、蕾丝、蝴蝶结与水滴饰物构成强烈的舞台轮廓。', '蓝白双色长发，内层深蓝、外层银白，垂至腰间', '水蓝色眼睛，明亮灵动', '纤细娇俏，动作充满表演感', '蓝白色宫廷礼服，收腰、层叠裙摆、白色蕾丝与蓝色蝴蝶结', ['蓝色宽檐圆顶礼帽', '白色羽毛装饰', '金色水滴饰物']),
  娜维娅: appearance('金色长发、蓝色眼睛的高挑女性；黑白金配色的蓬裙礼服、宽檐帽和阳伞形成华丽的枫丹社交名媛轮廓。', '金色长发，侧束成大卷马尾', '蓝色眼睛', '高挑匀称，姿态明快', '黑白金配色的枫丹蓬裙礼服、短靴与层叠裙摆', ['黑色宽檐帽', '岩晶饰物', '黄色阳伞']),
  夏沃蕾: appearance('红色短发、红色眼睛的高挑女性；黑白红配色的特巡队制服、贝雷帽和火枪体现纪律严明的执法者轮廓。', '红色短发，齐耳并略向外翘', '红色眼睛', '高挑利落，姿态挺直', '黑白红配色的枫丹特巡队制服、裙装、长靴与披肩', ['红色贝雷帽', '长枪/火枪', '火元素神之眼']),
  嘉明: appearance('棕红短发、金棕色眼睛的青年舞兽猎人；红金配色的璃月武术服、护腕和醒狮面具体现热烈的舞台动作。', '棕红色短发，发梢蓬松', '金棕色眼睛', '结实灵活，动作有爆发力', '红金配色的璃月舞兽服、短裤、护腕与长靴', ['醒狮面具', '舞兽道具', '双手剑']),
  闲云: appearance('浅蓝长发、紫色眼睛的高挑女性，常戴圆框眼镜；白蓝色改良仙家服与羽毛、机关装置展现优雅的发明家气质。', '浅蓝色长发，束成高马尾并垂至腰间', '紫色眼睛，佩戴圆框眼镜', '高挑修长，姿态从容', '白蓝色改良仙家长裙、披帛、金色腰饰与高跟鞋', ['圆框眼镜', '羽毛发饰', '机关装置']),
  千织: appearance('金色长发、金色眼睛的少女设计师；黑白红配色的稻妻与枫丹混合礼服、剪刀与丝带构成利落时装轮廓。', '金色长发，侧束成低马尾', '金色眼睛', '纤细修长，姿态利落', '黑白红配色的时装设计师礼服、短裙、长袜与靴子', ['发簪', '剪刀与丝带', '岩元素神之眼']),
  阿蕾奇诺: appearance('白发、红色眼睛的高挑女性，发梢带黑红渐变；黑色剪裁长衣、红色内衬和十字瞳孔强化冷峻的执行官轮廓。', '白色长发，发梢带黑红渐变并束成低马尾', '红色眼睛，瞳孔呈十字形', '高挑修长，气场压迫', '黑色剪裁长衣、红色内衬、手套与长靴', ['胸前十字饰物', '黑红披风', '长柄武器']),
  赛索斯: appearance('白发、金色眼睛的少年弓手，肤色偏深；白黑金配色的沙漠轻装、兜帽与绷带形成轻捷的远射轮廓。', '白色短发，额前碎发明显', '金色眼睛', '纤细敏捷，动作轻快', '白黑金配色的沙漠弓手服、披肩、短裤与护腿', ['兜帽/头巾', '护腕绷带', '弓']),
  克洛琳德: appearance('深紫长发、紫色眼睛的高挑女性；深蓝黑色决斗服、帽饰、手套和火枪构成严整锐利的枫丹决斗者轮廓。', '深紫色长发，侧束成低马尾', '紫色眼睛', '高挑修长，动作精准', '深蓝黑色决斗服、短裙、长靴与披肩', ['小礼帽', '手套', '火枪']),
  希格雯: appearance('浅蓝白发、蓝色眼睛的梅洛彼得堡美露莘护士；白蓝色护士服、耳朵和尾巴让她显得小巧温柔。', '浅蓝白色短发，发梢蓬松', '蓝色眼睛', '娇小幼态，动作轻快', '白蓝色护士制服、短裙、长袜与护士鞋', ['美露莘耳朵与尾巴', '护士帽', '水元素神之眼']),
  艾梅莉埃: appearance('浅绿色长发、绿色眼睛的成熟女性，气质安静洁净；黑白绿配色的香水设计师礼服、花叶和香水瓶形成优雅轮廓。', '浅绿色长发，侧分并束成低马尾', '绿色眼睛', '高挑纤细，举止克制', '黑白绿色枫丹礼服、长裙、手套与高跟鞋', ['香水瓶', '花叶发饰', '草元素神之眼']),
  卡齐娜: appearance('粉色短发、蓝色眼睛的娇小少女；白粉蓝配色的纳塔矿工装、护目镜与钻头载具体现坚韧活泼的轮廓。', '粉色短发，扎成两束小马尾', '蓝色眼睛', '娇小结实，动作灵活', '白粉蓝配色的纳塔矿工装、短裙、护膝与靴子', ['矿工护目镜', '钻头载具', '岩元素神之眼']),
  玛拉妮: appearance('深蓝长发、蓝色眼睛的少女向导；蓝白粉色的水上运动服、鲨鲨冲浪板和海洋饰物构成明快轮廓。', '深蓝色长发，侧束成高马尾', '蓝色眼睛', '纤细灵活，动作轻快', '蓝白粉色纳塔水上运动服、短裙、护腕与靴子', ['鲨鲨冲浪板', '海洋饰物', '水元素神之眼']),
  基尼奇: appearance('深绿色短发、绿色眼睛的少年猎人；黑绿金色纳塔猎装、护具与白色伙伴阿乔构成敏捷的丛林轮廓。', '深绿色短发，发梢利落', '绿色眼睛', '修长结实，动作迅捷', '黑绿金配色的纳塔猎装、护肩、短裤与长靴', ['阿乔', '绳索装置', '单手剑']),
  希诺宁: appearance('金色长发带青色挑染、金棕色眼睛的高挑女性；黑白金配色的纳塔工匠服、滑轮/护具与金属饰件突出技术感。', '金色长发，带青色挑染，侧束成高马尾', '金棕色眼睛', '高挑健美，姿态自信', '黑白金配色的纳塔工匠战装、护膝、长靴与金属护具', ['金属耳饰', '滑行护具', '岩元素神之眼']),
  恰斯卡: appearance('浅色长发带青绿色渐变、红橙色眼睛的高挑女性；纳塔空骑士风格的黑白绿服装、羽饰与浮空武器形成鲜明轮廓。', '浅灰白色长发，发梢带青绿色渐变', '红橙色眼睛', '高挑修长，动作张扬', '黑白绿配色的纳塔空骑士服、披肩、护腿与长靴', ['羽毛发饰', '浮空武器', '风元素神之眼']),
  欧洛伦: appearance('深紫长发、紫色眼睛的高挑青年；黑紫青色的烟谜主战装、兜帽和夜行配件构成神秘的山地轮廓。', '深紫色中长发，发梢凌乱', '紫色眼睛', '修长敏捷，姿态警觉', '黑紫青配色的纳塔夜行服、兜帽、护腕与长靴', ['夜行面罩', '雷元素神之眼', '弓']),
  玛薇卡: appearance('橙红长发、红色眼睛的高挑女性；黑红金配色的火神战装、皮衣轮廓与机车元素呈现强烈的领袖气场。', '橙红色长发，束成高马尾', '红色眼睛', '高挑健美，姿态强势', '黑红金配色的纳塔战装、皮革护具、长靴与火焰纹样', ['火焰纹金饰', '机车元素护具', '双手剑']),
  茜特菈莉: appearance('浅紫长发、紫色眼睛的女性，服装带白色毛绒与星月元素；紫蓝白配色与大型护符构成夜空般的轮廓。', '浅紫色长发，侧束成双股长发', '紫色眼睛', '纤细修长，动作轻盈', '紫蓝白配色的纳塔祭司服、毛绒披肩、短裙与长靴', ['星月护符', '白色毛绒饰物', '冰元素神之眼']),
  蓝砚: appearance('青蓝长发、蓝色眼睛的少女，身形轻盈；白青红配色的璃月工匠/舞者服装、环刃和飘带强化灵巧感。', '青蓝色长发，侧束成双马尾', '蓝色眼睛', '娇小灵活，动作轻盈', '白青红配色的璃月短装、飘带、护腕与布鞋', ['环刃', '发带', '风元素神之眼']),
  梦见月瑞希: appearance('粉色长发、蓝粉色眼睛的稻妻少女，服装采用柔和的粉白蓝色调；和风睡梦主题饰物使她显得轻盈梦幻。', '粉色长发，侧束成双股长发', '蓝粉色眼睛', '纤细娇小，动作柔和', '粉白蓝配色的稻妻和风礼装、短裙、长袜与木屐', ['梦境主题发饰', '狐/妖怪元素饰物', '风元素神之眼']),
  伊安珊: appearance('个子娇小、体格轻盈的纳塔少女，外观应保留运动训练者的活力和部族感；具体发色、瞳色与服装配色暂以参考图核验。', '当前 MCP 文本只明确小个子体态，发色待参考图核验', '待参考图核验', '个子娇小，动作轻快，具备训练者的身体感', '纳塔运动/战斗服装，具体款式待参考图核验', ['运动训练相关护具（待核验）'], 'mcp-text-incomplete'),
  瓦雷莎: appearance('体格有力量感的纳塔年轻战士，视觉重点是近身搏击、奔跑和自制的英雄面具；发色与服装细节以参考图核验。', '待参考图核验', '待参考图核验', '结实有力量感，适合近身搏击', '纳塔战斗/运动服，具体款式待参考图核验', ['英雄面具', '战斗护具'], 'mcp-text-incomplete'),
  爱可菲: appearance('以枫丹精密厨师与甜点师为视觉定位，服装应包含整洁的厨师制服、围巾或保温装备；发色、瞳色和最终造型以参考图核验。', '待参考图核验', '待参考图核验', '动作克制，适合精密烹饪与长时间工作', '枫丹厨师制服/工作装，具体款式待参考图核验', ['厨具机关', '食材背包', '围巾或保温装备（待核验）'], 'mcp-text-incomplete'),
  丝柯克: appearance('白色长发、冷色眼睛的纤细女性剑士，黑白蓝紫色的战斗服与飘带形成来自深渊的锋利轮廓；具体饰件以参考图核验。', '白色长发，带冷色渐变，垂至腰间', '浅紫或冷色眼睛，待参考图核验', '纤细修长，训练有素', '黑白蓝紫色的轻型战斗服、长靴与飘带', ['长剑', '冷色晶体饰件'], 'mcp-text-incomplete'),
  布伦妮: appearance('个子娇小的猎手，视觉锚点是暗黑重金属风穿搭、紫色雷元素神之眼和偏实用的猎装；具体发色与瞳色以参考图核验。', '待参考图核验', '待参考图核验', '娇小灵活，适合猎手行动', '暗黑重金属风猎装，带皮革、金属与深色层次', ['紫色雷元素神之眼', '重型战锤', '猎手装备'], 'mcp-text-incomplete'),
  洛恩: appearance('年轻的矮小弓手，暗藏深红的眼睛是当前 MCP 故事中的明确辨识线索；服装应保持西风骑士与弓手的实用轮廓。', '待参考图核验', '暗色眼睛中带深红色调', '身材偏矮，灵活敏捷', '西风骑士团弓手服，强调护具、腰包和行动便利', ['长弓', '箭囊', '骑士团徽记'], 'mcp-text-incomplete'),
  桑多涅: appearance('小个子机巧人偶般的少女，整体气质精致、克制而带发条机械感；服装和发色细节以参考图核验。', '待参考图核验', '待参考图核验', '小巧轻盈，机械动作感明显', '精致的至冬礼服/机巧人偶服，带结构化裙摆', ['发条机械装置', '大型机巧人偶', '茶点或机械工具'], 'mcp-text-incomplete'),
  奥黛塔: appearance('芭蕾舞者般纤细的女性，动作强调轻盈步伐、优雅姿态和流畅线条；服装颜色与发色以参考图核验。', '待参考图核验', '待参考图核验', '纤细柔韧，舞者体态', '芭蕾/舞台服装，强调轻盈裙摆与舞鞋', ['音乐盒或舞蹈人偶元素', '舞鞋'], 'mcp-text-incomplete'),
};

function factsFor(displayName) {
  const normalized = /^Furina\s*[—-]/i.test(displayName) ? '芙宁娜' : displayName;
  return catalogByName.get(normalized) || catalogByName.get(displayName) || {
    id: `project-${displayName}`,
    name: displayName,
    nameEn: '',
    region: '待定',
    element: '待定',
    visionSource: '待定',
    title: '待补充',
  };
}

function fallbackAppearance(displayName, facts) {
  return appearance(
    `当前 Akasha MCP 文本索引没有为${displayName}形成可核验的结构化发色、瞳色和服装条目。已保留角色定位：${facts.title || '待补充'}（${facts.region || '地区待补充'}）；不要仅凭姓名、元素或地区猜测外观，生成图前请补充参考图或手工字段。`,
    '待参考图核验',
    '待参考图核验',
    '待参考图核验',
    '默认造型待参考图核验',
    [],
    'mcp-text-incomplete',
  );
}

function compilePrompt(draft) {
  const heading = `你是${draft.displayName}` + (draft.englishName ? `(${draft.englishName})` : '') + (draft.originType === 'ip' && draft.work ? `，来自《${draft.work}》` : '') + '。';
  const identity = [draft.identity, draft.background, draft.currentSituation].filter(Boolean).join('\n\n') || draft.summary;
  const personality = Array.isArray(draft.personality) ? draft.personality.map((item) => `- ${item}`).join('\n') : '';
  const speech = draft.speech || {};
  const preferences = [
    Array.isArray(draft.likes) && draft.likes.length ? `喜欢：${draft.likes.join('；')}` : '',
    Array.isArray(draft.dislikes) && draft.dislikes.length ? `不喜欢：${draft.dislikes.join('；')}` : '',
    Array.isArray(draft.fears) && draft.fears.length ? `害怕：${draft.fears.join('；')}` : '',
  ].filter(Boolean).join('\n');
  const appearanceDraft = draft.appearance || {};
  const visual = [
    appearanceDraft.description,
    appearanceDraft.hair && `发型与发色：${appearanceDraft.hair}`,
    appearanceDraft.eyes && `眼睛：${appearanceDraft.eyes}`,
    appearanceDraft.build && `体态：${appearanceDraft.build}`,
    Array.isArray(appearanceDraft.outfits) && appearanceDraft.outfits.length ? `服装：${appearanceDraft.outfits.join('；')}` : '',
    Array.isArray(appearanceDraft.accessories) && appearanceDraft.accessories.length ? `饰品：${appearanceDraft.accessories.join('；')}` : '',
  ].filter(Boolean).join('\n');
  return [
    heading,
    `## 你的身份\n${identity || '尚未补充。'}`,
    `## 你的性格\n${personality || '- 尚未补充。'}`,
    preferences && `## 你的好恶\n${preferences}`,
    `## 你的外观\n${visual || '尚未补充。'}`,
    speech.tone && `说话语气：${speech.tone}`,
    speech.habits && `表达习惯：${speech.habits}`,
    Array.isArray(draft.boundaries) && draft.boundaries.length ? `## 你的边界\n${draft.boundaries.map((item) => `- ${item}`).join('\n')}` : '',
    Array.isArray(draft.secrets) && draft.secrets.length ? `## 你不会轻易说出的事\n${draft.secrets.map((item) => `- ${item}`).join('\n')}` : '',
    draft.extraRules && `## 额外规则\n${draft.extraRules}`,
  ].filter(Boolean).join('\n\n');
}

function relationshipRows(db, characterId) {
  return db.prepare('SELECT * FROM character_relationships WHERE from_character_id=? OR to_character_id=? ORDER BY updated_at DESC')
    .all(characterId, characterId)
    .map((row) => ({ id: String(row.id), fromCharacterId: String(row.from_character_id), toCharacterId: String(row.to_character_id), relationType: String(row.relation_type), description: String(row.description), updatedAt: String(row.updated_at) }));
}

if (!catalog.length) throw new Error('Akasha catalog is empty.');
if (!existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new DatabaseSync(dbPath);
const rows = db.prepare('SELECT * FROM character_profiles WHERE archived=0 ORDER BY display_name').all();
const sourcePayload = JSON.stringify({
  provider: 'Akasha MCP',
  tool: 'mcp__akasha__searchAkasha + mcp__akasha__listCharacters',
  retrievedAt: catalogPayload.retrievedAt || null,
  limitation: 'Akasha character text does not provide a complete structured visual field for every character.',
  appearanceByName,
});
const sourceHash = sha256(sourcePayload);
const now = new Date().toISOString();
const report = { dryRun, databaseCount: rows.length, catalogCount: catalog.length, mapped: 0, incomplete: 0, changed: 0, published: 0, skipped: [] };
const updated = new Map();

for (const row of rows) {
  const displayName = String(row.display_name);
  const facts = factsFor(displayName);
  const key = /^Furina\s*[—-]/i.test(displayName) ? '芙宁娜' : displayName;
  const selected = appearanceByName[key] || fallbackAppearance(displayName, facts);
  const currentDraft = JSON.parse(String(row.draft_json));
  const oldAppearance = currentDraft.appearance && typeof currentDraft.appearance === 'object' ? currentDraft.appearance : {};
  const nextAppearance = {
    ...clone(selected),
    defaultOutfitId: Object.prototype.hasOwnProperty.call(oldAppearance, 'defaultOutfitId') ? oldAppearance.defaultOutfitId : null,
    referenceIds: Array.isArray(oldAppearance.referenceIds) ? unique(oldAppearance.referenceIds) : [],
    sourceHash,
  };
  const draft = { ...currentDraft, appearance: nextAppearance };
  const changed = JSON.stringify(oldAppearance) !== JSON.stringify(nextAppearance);
  updated.set(String(row.id), { draft, facts, selected, changed });
  report.mapped++;
  if (selected.sourceConfidence === 'mcp-text-incomplete') report.incomplete++;
  if (changed) report.changed++;
}

if (!dryRun) {
  db.exec('BEGIN IMMEDIATE');
  try {
    let snapshotId = db.prepare('SELECT id FROM character_source_snapshots WHERE provider_id=? AND external_id=? AND payload_hash=?')
      .get('akasha-mcp', 'genshin-appearance-anchors', sourceHash)?.id;
    if (!snapshotId) {
      snapshotId = randomUUID();
      db.prepare(`INSERT INTO character_source_snapshots
        (id,provider_id,external_id,source_url,author,remote_version,remote_updated_at,fetched_at,payload_hash,format,parser_version,raw_file_path,raw_payload_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        snapshotId, 'akasha-mcp', 'genshin-appearance-anchors', 'https://akasha.daidr.me/service/mcp', 'Akasha MCP',
        String(catalogPayload.retrievedAt || ''), null, now, sourceHash, 'json', 'akasha-appearance-anchor-v1', null, sourcePayload, now,
      );
    }

    const updateProfile = db.prepare('UPDATE character_profiles SET draft_json=?,draft_revision=?,updated_at=? WHERE id=?');
    const insertProvenance = db.prepare(`INSERT INTO character_field_provenance
      (id,character_id,version,field_path,value_hash,source_kind,source_snapshot_id,source_pointer,evidence_json,derived_from_json,confirmed,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    const updateSource = db.prepare('UPDATE character_sources SET excerpt=?,fetched_at=?,payload_hash=?,source_snapshot_id=? WHERE character_id=? AND provider_id=?');

    for (const row of rows) {
      const result = updated.get(String(row.id));
      if (!result || !result.changed) continue;
      const { draft, facts, selected } = result;
      updateProfile.run(JSON.stringify(draft), Number(row.draft_revision || 1) + 1, now, String(row.id));
      updateSource.run(
        `Akasha MCP 角色索引已用于身份字段；外观字段为${selected.sourceConfidence === 'mcp-text-incomplete' ? '不完整 MCP 文本下的待核验定位' : '设计资料补全的视觉锚点'}，未宣称为逐字官方外观原文。`,
        now, sourceHash, snapshotId, String(row.id), 'akasha-mcp',
      );
      const sourceKind = selected.sourceConfidence === 'mcp-text-incomplete' ? 'source_extract' : 'ai_inferred';
      const evidence = JSON.stringify({
        tool: 'mcp__akasha__searchAkasha',
        structuredCatalog: 'mcp__akasha__listCharacters',
        note: selected.sourceConfidence === 'mcp-text-incomplete'
          ? 'Akasha text did not expose enough visual facts; only role/scene anchors were retained and marked for reference-image verification.'
          : 'The MCP catalog supplies character identity context. The visual anchor is a compact design-derived field and remains unconfirmed until the user supplies or approves a reference image.',
        facts,
      });
      for (const [fieldPath, value] of [
        ['/appearance/description', draft.appearance.description],
        ['/appearance/hair', draft.appearance.hair],
        ['/appearance/eyes', draft.appearance.eyes],
        ['/appearance/build', draft.appearance.build],
        ['/appearance/outfits', draft.appearance.outfits],
        ['/appearance/accessories', draft.appearance.accessories],
        ['/appearance/stableFeatures', draft.appearance.stableFeatures],
      ]) {
        insertProvenance.run(randomUUID(), String(row.id), null, fieldPath, sha256(value), sourceKind, snapshotId, `/characters/${facts.id}`, evidence, JSON.stringify(['/appearance']), 0, now);
      }
    }

    for (const row of rows.filter((item) => item.latest_version != null && updated.get(String(item.id))?.changed)) {
      const result = updated.get(String(row.id));
      const draft = result.draft;
      const version = Number(row.latest_version) + 1;
      const prompt = compilePrompt(draft);
      const relationships = JSON.stringify(relationshipRows(db, String(row.id)));
      const appearanceSnapshot = JSON.stringify({ ...draft.appearance, avatarAssetId: row.avatar_asset_id ?? null });
      const provenance = JSON.stringify(db.prepare('SELECT field_path,value_hash,source_kind,source_snapshot_id,source_pointer,evidence_json,confirmed FROM character_field_provenance WHERE character_id=? ORDER BY created_at DESC').all(String(row.id)));
      db.prepare(`INSERT OR REPLACE INTO character_versions
        (character_id,version,data_json,compiled_linshe_prompt,created_at,relationships_json,draft_revision,appearance_snapshot_json,provenance_json)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(String(row.id), version, JSON.stringify(draft), prompt, now, relationships, Number(row.draft_revision || 1) + 1, appearanceSnapshot, provenance);
      db.prepare('UPDATE character_profiles SET latest_version=?,updated_at=? WHERE id=?').run(version, now, String(row.id));
      db.prepare(`INSERT INTO personas(id,display_name,tags_json,source,latest_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,tags_json=excluded.tags_json,source=excluded.source,latest_version=excluded.latest_version,updated_at=excluded.updated_at`)
        .run(String(row.id), draft.displayName, JSON.stringify(draft.tags || []), 'character-library', version, String(row.created_at), now);
      db.prepare('INSERT OR REPLACE INTO persona_versions(persona_id,version,display_name,persona_prompt,appearance_prompt,avatar_artifact_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(String(row.id), version, draft.displayName, prompt, draft.appearance.description || null, row.avatar_asset_id ? String(row.avatar_asset_id) : null, JSON.stringify({ characterData: draft }), now);
      report.published++;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

console.log(JSON.stringify(report, null, 2));
db.close();
