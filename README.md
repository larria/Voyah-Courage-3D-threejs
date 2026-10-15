# 全新岚图知音 · three.js 3D 交互展示

基于岚图官网配置器（`configuration-3d-web.dsmp.voyah.com.cn`）的全新岚图知音 H37B 模型数据，用 three.js 重建的交互展示。非官方产品，与原 Unity 播放器并非完全等价。

- GitHub 源码：<https://github.com/larria/Voyah-Courage-3D-threejs>（`main`）
- Gitee 源码：<https://gitee.com/larria/Voyah-Courage-3D-ThreeJS>（`main`）
- GitHub Pages：<https://larria.github.io/Voyah-Courage-3D-threejs/>（部署完成并启用 Pages 后可访问）

## 当前功能

| 功能 | 实现 |
| --- | --- |
| 外观颜色 | 香槟金、玄英黑、宸星灰、杜若白、旭日红、深海蓝、皓月白，渐变切换 |
| 轮毂 | Trie_A 低风阻 / Trie_B 运动，两套网格四轮同步切换 |
| 内饰 | 旭日红 / 深海蓝 / 皓月白，座椅与拼色联动；安全带保持深灰 |
| 车门 | 四门独立或全部开合，65°，完整行程 2 秒线性动画 |
| 车窗 | 四窗独立升降，完整行程 2 秒；前窗下降 0.45m，后窗下降 0.30m，并沿 x 偏移 -0.033m、沿 z 按左右方向偏移 ±0.1153m |
| 后备箱 | 尾门上掀 76° |
| 行驶 | 轮胎滚动、道路流动、悬挂微起伏、自动开灯 |
| 灯光 | 大灯、尾灯、日行灯开关及自发光材质 |
| 视角 | 前侧、正前、侧身、后 45°、俯瞰、内饰预设及平滑切换 |

模型几何和部分材质信息来自原始资源；车漆、灯光、玻璃及纹理表现经过 three.js 环境下的视觉校准，并不宣称精确复刻官方渲染效果。门窗动画在本项目中实现，不代表官网父页面提供对应消息 API。

## 界面操作

桌面采用独立三维展台与右侧配置面板；手机采用上方展台与可收起的底部面板，两者不互相覆盖。通过「外观搭配 / 门窗开合 / 动态体验」切换配置类别；键盘可用左右方向键、Home、End 切换标签，Tab 与 Enter / Space 操作色彩和按钮。

- 车身色彩、内饰与轮毂分别选择，当前状态通过按钮高亮与 `aria-pressed` 表达。
- 四门与四窗可独立开合。「全部」按钮在部分开启时呈混合状态，再次操作将全部开启；全部开启后再次操作将全部关闭。
- 「全部关闭」仅关闭门窗与尾门，保留配色、灯光、行驶状态和相机。
- 展台底部提供六个视角。手动开始拖动会取消相机过渡；内饰视角保留近距离观察限制。
- 「行驶动画倍率」只控制轮胎与道路动画，不代表真实车速，不改变门窗动画时长。
- 加载期间车辆操作不可用；加载失败会显示重新加载按钮。系统减少动态效果设置只取消色彩与相机过渡，不改变物理开合动画。

## 本地运行

需要 Git、npm，以及 **Node.js 20.19+（20.x）或 22.12+**，符合当前 `web/package.json` 中 Vite 8 的要求。根目录只提供命令入口，依赖及锁文件在 `web/`。

```bash
npm ci --prefix web
npm run dev
# 通常为 http://localhost:5173，以终端输出为准
npm run build
npm run preview
```

## 项目结构

```text
README.md
CLAUDE.md                 # 项目维护约定
package.json              # 根目录命令入口，无需根目录 npm install
scripts/publish.mjs       # 双仓库源码同步与 Pages 部署
web/
  package.json
  package-lock.json
  index.html
  src/main.js             # 场景、材质、分组与动画
  src/npz.js              # NPZ / NumPy 加载器
  public/meshes.npz        # 提取后的模型网格
  public/scene.json        # 场景实例、矩阵和材质引用
  public/textures/         # 提取后的贴图
  dist/                   # 构建产物，不提交到 main
tools/export_final.py      # Unity 资源提取脚本
unity-player/             # 本地原始 Unity WebGL 资源，Git 忽略，不发布
```

## 数据提取

原配置器是 Unity WebGL 应用，输入资源为本地 `unity-player/Build/ZY.data`。`tools/export_final.py` 使用 UnityPy、NumPy 和 Pillow 提取场景层级、网格与贴图；Unity 左手坐标转为 three.js 右手坐标（z 反向并反转三角形绕序）。输出到项目 `web/public/`。

原始 `unity-player/` 不随源码仓库分发。仅在合法持有原始数据时进行提取；已有 `web/public/` 时，普通开发和发布不需要运行提取脚本。脚本按自身位置解析项目路径，不依赖调用者的工作目录。例如安装 uv 后可执行（PEP 723 声明了 Python 3.10+ 及依赖）

```bash
uv run /绝对路径/全新岚图知音3d模型/tools/export_final.py
```

原模型尺寸可用于检查坐标和比例，但不能仅凭网格边界推断官方整车尺寸或误差原因。

### Unity 消息边界

官网父页面可观察到的消息包括 `version`、`package`、`hubTab`、`exteriorTab`、`exterior`、`interior`。门窗触发由 Unity 场景内部交互处理；`triggerDoorLF` 等内部字段名称不能直接当成经过验证的 `SendMessage` API。本项目独立重建上表功能，不宣称实现原程序全部内部能力。

## 统一发布

不使用 GitHub Actions。唯一发布入口是项目根目录的 `npm run publish`。发布会产生 Git 推送，并在临时部署仓库中创建部署提交；**不会自动提交源代码**。

首次配置（仅在对应 remote 不存在时执行）

```bash
git remote add github https://github.com/larria/Voyah-Courage-3D-threejs.git
git remote add gitee https://gitee.com/larria/Voyah-Courage-3D-ThreeJS.git
```

需要两个仓库的写入权限及 Git HTTPS 身份认证，并配置 Git 提交身份。支持首次发布到空仓库；若远端已有 `main`，本地已提交的 `main` 必须包含其历史。若远端已有其它分支但没有 `main`，脚本会停止，要求先衔接已有历史。若分支发生分叉，先自行整合历史，不要强推。

```bash
npm ci --prefix web
# 自行审查并提交源代码，切换至 main，保证工作区干净
npm run publish
```

发布流程

1. 检查 Git 仓库根目录、Node 版本、当前分支及干净工作区；校验两个 remote 的 fetch/push URL 与上面的 HTTPS URL 完全一致（含大小写和 `.git`）。
2. fetch 两个远端 `main`，确认它们均为本地源提交的祖先，确保源码可以快进；任何推送之前完成这些检查。
3. 使用 `PAGES_BASE=/Voyah-Courage-3D-threejs/` 执行 `npm --prefix web run build`，检查输出及源提交未改变。
4. 在临时克隆中准备 `gh-pages`：已有分支则保留其提交历史；没有则创建 orphan 分支。将 `web/dist/` 内容放在分支根目录，添加 `.nojekyll`，有变化才提交；提交包含源 SHA 和 `Co-Authored-By: Claude <noreply@anthropic.com>` trailer。
5. 依次推送 **Gitee main → GitHub main → GitHub gh-pages**，均不使用 force。并发远端更新可能使推送被拒绝，脚本不会覆盖它们。
6. 无论成功或失败都清理临时目录；失败时明确打印已成功的推送，不会自动回滚，解决错误后可重新运行。

本机未安装 `gh` CLI。首次部署后，在 GitHub 仓库网页中手动打开 **Settings → Pages → Build and deployment**，选择 **Deploy from a branch**，分支选 **gh-pages**，目录选 **/(root)** 并保存。Pages 发布可能稍有延迟；脚本推送成功不等于网站已立即上线。

## 权利与使用限制

车型名称、商标、模型、贴图及原始 Unity 资源属于其各自权利人。资源来源不构成再分发、商业使用或改作授权，使用或公开发布前需自行确认相应权利。

`web/package.json` 中现有的 `ISC` 字段不授予任何第三方模型或贴图权利，也不应解释为本仓库全部内容的统一许可。第三方依赖适用各自许可证；本项目不额外授予第三方资产许可。
