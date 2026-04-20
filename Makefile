ROOT_DIR   := $(shell pwd)
BRIDGE_DIR := $(ROOT_DIR)/openclaw-bridge
WCC_DIR    := $(ROOT_DIR)/wechat-claude-code

.PHONY: build install restart verify clean help

help: ## 显示帮助
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

# ── 构建 ──────────────────────────────────────────────

build: ## 构建两个项目
	@echo "==> 构建 openclaw-bridge"
	cd $(BRIDGE_DIR) && npm install --production=false 2>&1 | tail -1 && npm run build 2>&1
	@echo "==> 构建 wechat-claude-code"
	cd $(WCC_DIR) && npm install --production=false 2>&1 | tail -1 && npm run build 2>&1
	@echo "==> 构建完成"

build-bridge:
	@echo "==> 构建 openclaw-bridge"
	cd $(BRIDGE_DIR) && npm install --production=false 2>&1 | tail -1 && npm run build 2>&1

build-wcc:
	@echo "==> 构建 wechat-claude-code"
	cd $(WCC_DIR) && npm install --production=false 2>&1 | tail -1 && npm run build 2>&1

# ── 安装 ──────────────────────────────────────────────

install: build ## 构建 + 安装 bridge 插件到 OpenClaw
	@echo "==> 安装 openclaw-bridge 插件"
	openclaw plugins install --force $(BRIDGE_DIR) 2>&1
	openclaw config set channels.openclaw-bridge.enabled true 2>/dev/null || true
	openclaw config set channels.openclaw-bridge.port 3847 2>/dev/null || true
	@echo "==> 安装完成"

# ── 重启 ──────────────────────────────────────────────

restart-gateway: ## 仅重启 OpenClaw gateway
	openclaw gateway restart 2>&1
	@echo "==> 等待 gateway 启动..."
	@sleep 5
	@curl -sf http://localhost:3847/health >/dev/null 2>&1 && echo "==> gateway 已就绪" || echo "==> gateway 可能还在启动中"

restart-wcc: ## 仅重启 wcc daemon
	@echo "==> 停止现有 wcc daemon..."
	@pkill -f "node.*dist/main.js.*start" 2>/dev/null || true
	@sleep 1
	@echo "==> 启动 wcc daemon..."
	cd $(WCC_DIR) && nohup node dist/main.js start > /dev/null 2>&1 &
	@sleep 2
	@echo "==> wcc 已启动"

restart: install restart-gateway restart-wcc ## 一键全部：构建+安装+重启 gateway+重启 wcc
	@echo ""
	@echo "==> 全部完成"
	@echo "  gateway: $$(curl -sf http://localhost:3847/health 2>/dev/null || echo '未响应')"
	@echo "  wcc: PID $$(pgrep -f 'node.*dist/main.js.*start' | head -1 || echo '未运行')"
	@echo ""

# ── 验证 ──────────────────────────────────────────────

verify: ## 验证安装状态
	@echo ""
	@echo "==> 验证安装状态"
	@test -f $(BRIDGE_DIR)/dist/src/http-server.js && echo "  bridge: 文件完整" || echo "  bridge: 缺少构建文件"
	@test -f $(WCC_DIR)/dist/main.js && echo "  wcc: 文件完整" || echo "  wcc: 缺少构建文件"
	@test -d ~/.openclaw/extensions/openclaw-bridge && echo "  bridge: 已安装到 extensions" || echo "  bridge: 未安装"
	@command -v openclaw >/dev/null 2>&1 && openclaw plugins list 2>/dev/null | grep -q "openclaw-bridge" && echo "  bridge: 已加载" || echo "  bridge: 未加载"
	@curl -sf http://localhost:3847/health >/dev/null 2>&1 && echo "  gateway: 运行中" || echo "  gateway: 未运行"
	@curl -sf http://localhost:3848/push >/dev/null 2>&1 || echo "  push-server: 运行中 (POST only)" 2>/dev/null; true
	@echo ""

# ── 清理 ──────────────────────────────────────────────

clean: ## 清理构建产物
	rm -rf $(BRIDGE_DIR)/dist $(BRIDGE_DIR)/node_modules/.cache
	rm -rf $(WCC_DIR)/dist $(WCC_DIR)/node_modules/.cache
	@echo "==> 已清理"
