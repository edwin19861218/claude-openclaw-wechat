#!/bin/bash
set -euo pipefail

# =============================================================================
# 微信统一入口安装脚本
# 安装 openclaw-bridge 插件 + 构建 wechat-claude-code
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BRIDGE_DIR="${ROOT_DIR}/openclaw-bridge"
WCC_DIR="${ROOT_DIR}/wechat-claude-code"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# =============================================================================
# Prerequisites check
# =============================================================================

check_prerequisites() {
  info "检查前置条件..."

  command -v node >/dev/null 2>&1 || error "需要 Node.js >= 18"
  local node_ver=$(node -v | sed 's/v//' | cut -d. -f1)
  [ "$node_ver" -ge 18 ] || error "Node.js 版本需要 >= 18，当前: $(node -v)"

  command -v npm >/dev/null 2>&1 || error "需要 npm"
}

# =============================================================================
# 1. Build openclaw-bridge
# =============================================================================

build_bridge() {
  info "构建 openclaw-bridge..."
  cd "$BRIDGE_DIR"

  npm install --production=false 2>&1 | tail -3
  npm run build 2>&1

  [ -f "dist/src/http-server.js" ] || error "openclaw-bridge 构建失败"
  info "openclaw-bridge 构建成功"
}

# =============================================================================
# 2. Install openclaw-bridge as OpenClaw plugin
# =============================================================================

install_bridge_plugin() {
  info "安装 openclaw-bridge 到 OpenClaw..."

  if ! command -v openclaw >/dev/null 2>&1; then
    warn "未找到 openclaw CLI，跳过插件安装"
    warn "请手动将 openclaw-bridge 目录复制到 ~/.openclaw/extensions/"
    return 0
  fi

  # Use openclaw plugins install --force to copy the plugin
  # (symlinks are rejected because openclaw validates real paths stay within extensions)
  if openclaw plugins list 2>/dev/null | grep -q "openclaw-bridge"; then
    info "openclaw-bridge 已安装，更新中..."
    openclaw plugins install --force "$BRIDGE_DIR" 2>&1 || {
      warn "插件安装失败，请手动: openclaw plugins install --force ${BRIDGE_DIR}"
    }
  else
    openclaw plugins install "$BRIDGE_DIR" 2>&1 || {
      warn "插件安装失败，请手动: openclaw plugins install ${BRIDGE_DIR}"
    }
  fi

  # Configure channel
  openclaw config set channels.openclaw-bridge.enabled true 2>/dev/null || true
  openclaw config set channels.openclaw-bridge.port 3847 2>/dev/null || true

  info "openclaw-bridge 插件已安装"
}

# =============================================================================
# 3. Build wechat-claude-code
# =============================================================================

build_wcc() {
  info "构建 wechat-claude-code..."
  cd "$WCC_DIR"

  npm install --production=false 2>&1 | tail -3
  npm run build 2>&1

  [ -f "dist/main.js" ] || error "wechat-claude-code 构建失败"
  [ -f "dist/openclaw/bridge-client.js" ] || error "bridge-client 模块未构建"
  info "wechat-claude-code 构建成功"
}

# =============================================================================
# 4. Verify
# =============================================================================

verify() {
  echo ""
  info "========== 验证安装 =========="
  echo ""

  # Check bridge files
  local bridge_ok=true
  for f in dist/src/http-server.js dist/src/channel.js dist/src/types.js; do
    if [ ! -f "${BRIDGE_DIR}/${f}" ]; then
      error "缺少文件: ${BRIDGE_DIR}/${f}"
      bridge_ok=false
    fi
  done
  if $bridge_ok; then
    info "openclaw-bridge: 文件完整"
  fi

  # Check wcc files
  local wcc_ok=true
  for f in dist/main.js dist/openclaw/bridge-client.js dist/openclaw/health.js dist/commands/handlers.js dist/commands/router.js; do
    if [ ! -f "${WCC_DIR}/${f}" ]; then
      error "缺少文件: ${WCC_DIR}/${f}"
      wcc_ok=false
    fi
  done
  if $wcc_ok; then
    info "wechat-claude-code: 文件完整"
  fi

  # Check openclaw plugin installation
  local PLUGIN_DIR="$HOME/.openclaw/extensions/openclaw-bridge"
  if [ -d "$PLUGIN_DIR" ]; then
    info "openclaw-bridge: 已安装到 ~/.openclaw/extensions/"
  else
    warn "openclaw-bridge: 未安装到 ~/.openclaw/extensions/"
    warn "  运行: bash $0 install"
  fi

  # Check openclaw plugin loaded
  if command -v openclaw >/dev/null 2>&1; then
    if openclaw plugins list 2>/dev/null | grep -q "openclaw-bridge"; then
      info "openclaw-bridge: 已在 OpenClaw 中加载"
    else
      warn "openclaw-bridge: 未在 OpenClaw 中加载"
      warn "  运行: openclaw gateway restart"
    fi
  fi

  # Check bridge HTTP health
  if curl -sf http://localhost:3847/health >/dev/null 2>&1; then
    info "openclaw-bridge: HTTP 服务已运行"
  else
    warn "openclaw-bridge: HTTP 服务未运行（需先启动 gateway）"
  fi

  echo ""
  info "========== 安装完成 =========="
  echo ""
  echo "下一步操作:"
  echo ""
  echo "1. 重启 OpenClaw gateway 以加载新插件:"
  echo "   openclaw gateway restart"
  echo ""
  echo "2. 启动 wechat-claude-code daemon:"
  echo "   cd ${WCC_DIR}"
  echo "   npm run daemon -- start"
  echo ""
  echo "3. 在微信中测试:"
  echo "   /switch openclaw    # 切换到 OpenClaw"
  echo "   你好                # 发消息给 OpenClaw"
  echo "   /switch claude      # 切回 Claude Code"
  echo ""
}

# =============================================================================
# Main
# =============================================================================

main() {
  local cmd="${1:-install}"

  case "$cmd" in
    install)
      check_prerequisites
      build_bridge
      install_bridge_plugin
      build_wcc
      verify
      ;;
    build)
      check_prerequisites
      build_bridge
      build_wcc
      info "构建完成"
      ;;
    verify)
      verify
      ;;
    *)
      echo "用法: $0 {install|build|verify}"
      echo ""
      echo "  install  — 构建 + 安装插件 + 验证（默认）"
      echo "  build    — 仅构建两个项目"
      echo "  verify   — 验证安装状态"
      exit 1
      ;;
  esac
}

main "$@"
