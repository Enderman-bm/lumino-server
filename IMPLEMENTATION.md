# Lumino 协作系统 - 实现总结

## 项目结构

### 服务器端 (lumino-server/)

```
lumino-server/
├── src/
│   ├── types/
│   │   └── index.ts          # TypeScript类型定义
│   ├── handlers/
│   │   └── messageHandler.ts  # 消息处理器
│   ├── utils/
│   │   └── index.ts          # 工具函数
│   ├── index.ts              # 服务器入口
│   ├── websocketServer.ts    # WebSocket服务器
│   ├── roomManager.ts        # 房间管理器
│   └── userManager.ts        # 用户管理器
├── package.json
├── tsconfig.json
└── README.md
```

### 客户端 (lumino-rs/crates/collaboration/)

```
crates/collaboration/
├── src/
│   ├── handlers/
│   │   └── mod.rs            # 消息处理模块
│   ├── lib.rs                # 库入口
│   ├── types.rs              # Rust类型定义
│   └── client.rs             # 协作客户端
├── examples/
│   └── basic.rs              # 使用示例
└── Cargo.toml
```

## 核心功能

### 1. 用户认证系统
- 用户输入用户名连接到服务器
- 服务器返回唯一的用户ID和邀请码
- 用户名验证（长度、非法字符检查）

### 2. 房间管理系统
- **创建房间**: 用户可创建新协作房间，自动生成6位邀请码
- **加入房间**: 通过邀请码加入现有房间
- **离开房间**: 正常离开或断开连接时自动清理
- **房主转移**: 房主离开时自动转移给下一个用户

### 3. 实时数据传输

#### 鼠标位置同步
```typescript
{
  type: 'mouseMove',
  position: {
    x: number,
    y: number,
    viewState?: ViewState
  }
}
```

#### 音符批量操作（复制/粘贴优化）
```typescript
{
  type: 'noteBatch',
  notes: {
    action: 'add' | 'update' | 'delete' | 'move' | 'copy' | 'paste',
    notes: Note[],
    sourceTrack?: number,
    targetTrack?: number,
    tickOffset?: number,
    keyOffset?: number
  }
}
```

#### MIDI事件同步
```typescript
{
  type: 'midiEvent',
  event: MidiEvent
}

{
  type: 'midiEventBatch',
  events: MidiEvent[]
}
```

#### 项目状态同步
- 视图状态（滚动、缩放）
- 工程文件信息
- 完整状态同步请求/响应

### 4. 连接管理
- WebSocket连接（基于`ws`库）
- 心跳检测（30秒间隔）
- 自动清理不活跃连接
- 支持压缩传输

## 使用流程

### 1. 启动服务器

```bash
cd lumino-server
npm install
npm run dev
```

服务器将在 `ws://localhost:3000/ws` 监听WebSocket连接

### 2. 客户端连接流程

```rust
// 1. 创建客户端
let config = ClientConfig {
    server_host: "localhost".to_string(),
    server_port: 3000,
    username: "用户名".to_string(),
    ..Default::default()
};

let mut client = CollaborationClient::new(config);

// 2. 设置事件回调
client.set_event_callback(|event| {
    match event {
        CollaborationEvent::Authenticated { user_id, invite_code } => {
            println!("认证成功！邀请码: {}", invite_code);
        }
        CollaborationEvent::MouseUpdate { user_id, position, color } => {
            // 在其他用户位置显示光标
        }
        _ => {}
    }
});

// 3. 连接服务器
client.connect(None, None).await?;

// 4. 创建或加入房间
client.create_room("房间名称".to_string())?;
// 或
client.join_room("ABC123".to_string())?;

// 5. 发送数据
client.send_mouse_position(position)?;
client.send_note_batch(operation)?;
```

## 数据结构映射

### 与 lumino-rs 的数据对应关系

| 服务器类型 | lumino-rs 类型 | 说明 |
|-----------|---------------|------|
| `ViewState` | `ui::editor::state::ViewState` | 编辑器视图状态 |
| `Note` | `ui::editor::note::Note` | 音符数据 |
| `MidiEvent` | `core::midi::event::MidiEvent` | MIDI事件 |
| `MousePosition` | 新增 | 鼠标位置 |

## 性能优化

1. **批量传输**: 复制粘贴等操作批量发送，减少网络开销
2. **压缩传输**: WebSocket启用per-message-deflate压缩
3. **心跳机制**: 保持连接活跃，及时检测断线
4. **节流处理**: 鼠标位置等高频事件可在客户端节流

## 安全考虑

1. 输入验证（用户名长度、非法字符）
2. 房间人数限制（默认10人）
3. 自动清理不活跃用户和房间
4. 邀请码随机生成，6位字母数字组合

## 后续可扩展功能

1. **操作历史**: 支持撤销/重做协作操作
2. **权限系统**: 区分只读/编辑权限
3. **语音聊天**: 集成WebRTC语音通话
4. **版本控制**: 保存项目历史版本
5. **端到端加密**: 敏感数据传输加密

## API文档

详见 `README.md` 文件
