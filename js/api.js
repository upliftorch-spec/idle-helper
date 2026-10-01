/* ===== 閒人地圖 — API Client ===== */
(function () {
  'use strict'

  const BASE_URL = location.hostname === 'localhost'
    ? 'https://idle-helper-service-YOUR_GOOGLE_PROJECT_NUMBER.asia-east1.run.app'
    : 'https://idle-helper-service-YOUR_GOOGLE_PROJECT_NUMBER.asia-east1.run.app'

  const CHAT_BASE_URL = location.hostname === 'localhost'
    ? 'http://localhost:7011'
    : 'https://chat-service-YOUR_GOOGLE_PROJECT_NUMBER.asia-east1.run.app'

  const CHAT_PROJECT = 'idle-helper'

  function getToken() {
    let token = localStorage.getItem('idle-token') || null
    if (token) {
      let expired = false
      try {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
        expired = !Number.isFinite(payload.exp) || Date.now() >= payload.exp * 1000
      } catch (error) {
        expired = true
      }
      if (expired) {
        clearToken()
        token = null
        window.dispatchEvent(new CustomEvent('idle:auth-required'))
      }
    }
    return token
  }

  function setToken(token) {
    localStorage.setItem('idle-token', token)
  }

  function clearToken() {
    localStorage.removeItem('idle-token')
  }

  async function request(method, path, data, baseUrl) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    }

    const token = getToken()
    if (token) {
      opts.headers.Authorization = 'Bearer ' + token
    }

    if (data && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
      opts.body = JSON.stringify(data)
    }

    if (data && method === 'GET') {
      const params = new URLSearchParams()
      Object.keys(data).forEach(function (k) {
        if (data[k] !== undefined && data[k] !== null) {
          params.set(k, data[k])
        }
      })
      path += '?' + params.toString()
    }

    const res = await fetch((baseUrl || BASE_URL) + path, opts)

    if (res.status === 401 && token && localStorage.getItem('idle-token') === token) {
      clearToken()
      window.dispatchEvent(new CustomEvent('idle:auth-required'))
    }

    const json = await res.json()
    if (json && json.code === 'service_area_unavailable') {
      const error = new Error(IdleServiceArea.message)
      error.code = json.code
      throw error
    }
    return json
  }

  // ===== Auth =====
  async function login(username, password) {
    const result = await request('POST', '/api/idle-helper/login', { username, password })
    if (result && result.data && result.data.token) {
      setToken(result.data.token)
    }
    return result
  }

  async function registerGoogle(credential, accessToken, nickname) {
    const result = await request('POST', '/api/idle-helper/register_google', { credential, accessToken, nickname })
    if (result && result.data && result.data.token) {
      setToken(result.data.token)
    }
    return result
  }

  async function registerApple(identityToken, nickname) {
    const result = await request('POST', '/api/idle-helper/register_apple', { identityToken, nickname })
    if (result && result.data && result.data.token) {
      setToken(result.data.token)
    }
    return result
  }

  async function me() {
    return request('GET', '/api/idle-helper/me')
  }

  async function recentAcceptedTasks() {
    return request('GET', '/api/idle-helper/task/recent-accepted')
  }

  // ===== Profile =====
  async function createProfile(data) {
    return request('POST', '/api/idle-helper/profile/create', data)
  }

  async function myProfile() {
    return request('GET', '/api/idle-helper/profile/mine')
  }

  async function profileDetail(profileId) {
    return request('GET', '/api/idle-helper/profile/detail', { profileId })
  }

  async function updateProfile(data) {
    return request('PUT', '/api/idle-helper/profile/update', data)
  }

  async function uploadAvatar(image) {
    return request('POST', '/api/idle-helper/profile/avatar', { image })
  }

  async function toggleOnline(isOnline, lat, lng, availableHours) {
    if (isOnline) IdleServiceArea.assertInside(lat, lng)
    return request('POST', '/api/idle-helper/profile/toggle-online', { isOnline, lat, lng, availableHours })
  }

  async function updateLocation(lat, lng) {
    return request('POST', '/api/idle-helper/profile/location', { lat, lng })
  }

  async function nearbyProfiles(lat, lng, opts) {
    IdleServiceArea.assertInside(lat, lng)
    return request('GET', '/api/idle-helper/profile/nearby', {
      lat, lng,
      radius: opts && opts.radius,
      category: opts && opts.category,
      limit: opts && opts.limit,
      offset: opts && opts.offset,
    })
  }

  // ===== Achievement =====
  async function achievements(userId) {
    return request('GET', '/api/idle-helper/achievement', { userId })
  }

  // ===== Service =====
  async function createService(data) {
    return request('POST', '/api/idle-helper/service/create', data)
  }

  async function listServices() {
    return request('GET', '/api/idle-helper/service/list')
  }

  async function updateService(data) {
    return request('PUT', '/api/idle-helper/service/update', data)
  }

  async function removeService(serviceId) {
    return request('DELETE', '/api/idle-helper/service/remove', { serviceId })
  }

  async function searchTaskLibrary(keyword, category, limit) {
    return request('GET', '/api/idle-helper/task-library/search', { keyword, category, limit })
  }

  async function addTaskLibraryToServices(templateIds, pricePerHour) {
    return request('POST', '/api/idle-helper/task-library/add-to-services', { templateIds, pricePerHour })
  }

  // ===== Task =====
  async function createTask(data) {
    IdleServiceArea.assertInside(data.lat, data.lng)
    return request('POST', '/api/idle-helper/task/create', data)
  }

  async function nearbyTasks(lat, lng, opts) {
    IdleServiceArea.assertInside(lat, lng)
    return request('GET', '/api/idle-helper/task/nearby', {
      lat, lng,
      radius: opts && opts.radius,
      category: opts && opts.category,
      status: opts && opts.status,
      taskType: opts && opts.taskType,
      limit: opts && opts.limit,
      offset: opts && opts.offset,
    })
  }

  async function taskDetail(taskId) {
    return request('GET', '/api/idle-helper/task/detail', { taskId })
  }

  async function myPublishedTasks(status) {
    return request('GET', '/api/idle-helper/task/published', { status })
  }

  async function myAssignedTasks() {
    return request('GET', '/api/idle-helper/task/assigned')
  }

  async function myTaskResponses() {
    return request('GET', '/api/idle-helper/task/my-responses')
  }

  async function respondToTask(taskId, quoteAmount, message) {
    return request('POST', '/api/idle-helper/task/respond', { taskId, quoteAmount, message })
  }

  async function taskResponses(taskId) {
    return request('GET', '/api/idle-helper/task/responses', { taskId })
  }

  async function acceptTaskResponse(responseId) {
    return request('POST', '/api/idle-helper/task/accept-response', { responseId })
  }

  async function updateTaskStatus(taskId, status) {
    return request('PUT', '/api/idle-helper/task/status', { taskId, status })
  }

  // ===== Review =====
  async function createReview(taskId, revieweeId, rating, comment) {
    return request('POST', '/api/idle-helper/review/create', { taskId, revieweeId, rating, comment })
  }

  async function reviewsByTask(taskId) {
    return request('GET', '/api/idle-helper/review/task', { taskId })
  }

  async function reviewsByUser(userId) {
    return request('GET', '/api/idle-helper/review/user', { userId })
  }

  async function myReviews() {
    return request('GET', '/api/idle-helper/review/mine')
  }

  // ===== Account =====
  async function deleteAccount() {
    return request('DELETE', '/api/idle-helper/account')
  }

  // ===== Report =====
  async function reportUser(reportedUserId, reason, description, conversationId) {
    return request('POST', '/api/idle-helper/report/create', { reportedUserId, reason, description, conversationId })
  }

  async function blockUser(blockedUserId) {
    return request('POST', '/api/idle-helper/report/block', { blockedUserId })
  }

  // ===== Chat（chat-service 微服務）=====
  async function startConversation(targetUserId, taskId) {
    return request('POST', '/api/chat/start', {
      project: CHAT_PROJECT,
      targetUserId,
      referenceId: taskId,
    }, CHAT_BASE_URL)
  }

  async function listConversations() {
    return request('GET', '/api/chat/list', { project: CHAT_PROJECT }, CHAT_BASE_URL)
  }

  async function chatMessages(conversationId, limit, offset) {
    return request('GET', '/api/chat/messages', { conversationId, limit, offset }, CHAT_BASE_URL)
  }

  async function sendChatMessage(conversationId, content) {
    return request('POST', '/api/chat/send', { conversationId, content }, CHAT_BASE_URL)
  }

  async function markChatRead(conversationId) {
    return request('POST', '/api/chat/read', { conversationId }, CHAT_BASE_URL)
  }

  // ===== WebSocket（chat-service）=====
  var ws = null
  var wsCallbacks = []
  var wsReconnectTimer = null
  var wsHeartbeatTimer = null

  function emitWS(data) {
    wsCallbacks.forEach(function (cb) { cb(data) })
  }

  function connectWS() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return

    var wsUrl = CHAT_BASE_URL.replace('https', 'wss').replace('http', 'ws') + '/ws'
    ws = new WebSocket(wsUrl)

    ws.onopen = function () {
      if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer)
        wsReconnectTimer = null
      }
      var token = getToken()
      if (token) {
        ws.send(JSON.stringify({ type: 'auth', token: token }))
      }
      if (wsHeartbeatTimer) clearInterval(wsHeartbeatTimer)
      wsHeartbeatTimer = setInterval(function () {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }))
        }
      }, 25000)
    }

    ws.onmessage = function (event) {
      try {
        var data = JSON.parse(event.data)
        emitWS(data)
      } catch (e) {
        emitWS({ type: 'ws_error', message: 'bad_payload' })
      }
    }

    ws.onclose = function () {
      if (wsHeartbeatTimer) {
        clearInterval(wsHeartbeatTimer)
        wsHeartbeatTimer = null
      }
      emitWS({ type: 'ws_closed' })
      if (!wsReconnectTimer) {
        wsReconnectTimer = setTimeout(function () {
          wsReconnectTimer = null
          connectWS()
        }, 3000)
      }
    }

    ws.onerror = function () {
      emitWS({ type: 'ws_error', message: 'connection_error' })
    }
  }

  function onWSMessage(callback) {
    wsCallbacks.push(callback)
  }

  // ===== 推播 token =====
  async function registerPush(token, platform) {
    return request('POST', '/api/idle-helper/push/register', { token, platform })
  }

  async function unregisterPush(token) {
    return request('POST', '/api/idle-helper/push/unregister', { token })
  }

  // ===== Export =====
  window.IdleAPI = {
    getToken, setToken, clearToken,
    login, registerGoogle, registerApple, me, recentAcceptedTasks,
    createProfile, myProfile, profileDetail, updateProfile, uploadAvatar,
    toggleOnline, updateLocation, nearbyProfiles, achievements,
    createService, listServices, updateService, removeService, searchTaskLibrary, addTaskLibraryToServices,
    createTask, nearbyTasks, taskDetail,
    myPublishedTasks, myAssignedTasks, myTaskResponses, respondToTask, taskResponses, acceptTaskResponse, updateTaskStatus,
    createReview, reviewsByTask, reviewsByUser, myReviews,
    deleteAccount, reportUser, blockUser,
    startConversation, listConversations, chatMessages, sendChatMessage, markChatRead,
    connectWS, onWSMessage,
    registerPush, unregisterPush,
  }
})()
