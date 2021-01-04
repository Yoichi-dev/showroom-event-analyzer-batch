'use strict';

require('dotenv').config()

let admin = require('firebase-admin');
let serviceAccount = require(process.env.API_KEY_DIR);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const jsdom = require("jsdom")
const { JSDOM } = jsdom
let request = require('then-request')
let cron = require('node-cron')

const PROFILE_URL = "https://www.showroom-live.com/api/room/profile?room_id="
const EVENT_SUPPORT_URL = "https://www.showroom-live.com/api/room/event_and_support?room_id="

async function eventUpdate() {
    // 取得時間
    let analyze_time = Math.floor(new Date().getTime() / 1000)
    console.log(analyze_time)
    console.log('Start - function')

    console.log('Start - get event Data')
    let eventData = await getEventData()
    console.log(' End  - get event Data')

    console.log('Start - loop event')
    let eventList = []
    eventData.forEach(function (doc) {

        let updateEventId = doc.id
        let baseJson = doc.data()

        // イベントが終了しているか確認
        if (analyze_time > baseJson.ended_at) {
            console.log(`${updateEventId} - イベント終了`)
            return
        }

        eventList.push({
            id: updateEventId,
            jsonData: baseJson
        })
    })
    console.log(' End  - loop event')

    console.log('------------')
    console.log('更新イベント数' + eventList.length + '件')
    console.log('------------')

    console.log('Start - get update data')
    for (let i = 0; i < eventList.length; i++) {

        // イベント名
        console.log(eventList[i].jsonData.event_name)

        // イベント途中参加者の為のカウント
        let addCount = eventList[i].jsonData.data[0].point.length
        console.log(addCount + '回データ取得済')

        let oneEventData = await getShowroomData(eventList[i].jsonData.event_url, "")
        if (oneEventData.statusCode != 200) {
            return
        }

        // DOM操作可能に
        const dom = new JSDOM(oneEventData.getBody('utf8'))
        // 参加者を選択
        let domData = dom.window.document.getElementsByClassName('js-follow-btn')
        for (let j = 0; j < domData.length; j++) {

            // ユーザのルームID
            let userRoomId = domData[j].dataset.roomId

            // ユーザのプロフィールを取得
            let userProfile = await getShowroomData(PROFILE_URL, userRoomId)
            if (userProfile.statusCode != 200) {
                console.log('ユーザプロフィール取得失敗' + userRoomId)
                return
            }
            let userProfileJson = JSON.parse(userProfile.getBody('utf8'))
            console.log(userRoomId + ":" + userProfileJson.room_name)


            // // ユーザイベント情報を取得
            let userEvent = await getShowroomData(EVENT_SUPPORT_URL, userRoomId)
            if (userEvent.statusCode != 200) {
                console.log('ユーザ参加イベント取得失敗' + userRoomId)
                return
            }
            let userEventJson = JSON.parse(userEvent.getBody('utf8'))

            // 既に登録済みか確認
            let flg = eventList[i].jsonData.data.some((val) => val.room_id === userRoomId)

            if (flg) {
                console.log('更新')
                eventList[i].jsonData.data.forEach(data => {
                    if (data.room_id === userRoomId) {
                        data.room_name = userProfileJson.room_name
                        data.point.push({
                            "follower_num": userProfileJson.follower_num,
                            "rank": userEventJson.event.ranking.rank,
                            "next_rank": userEventJson.event.ranking.next_rank,
                            "point": userEventJson.event.ranking.point,
                            "gap": userEventJson.event.ranking.gap,
                            "create_at": analyze_time
                        })
                    }
                })
            } else {
                console.log('新規追加')
                let subJson = {
                    "room_id": userRoomId,
                    "room_name": userProfileJson.room_name,
                    "room_url_key": userProfileJson.room_url_key,
                    "point": [
                    ]
                }
                for (let k = 0; k < addCount; k++) {
                    subJson.point.push({
                        "follower_num": userProfileJson.follower_num,
                        "rank": eventList[i].jsonData.data.length,
                        "next_rank": eventList[i].jsonData.data.length - 1,
                        "point": 0,
                        "gap": userEventJson.event.ranking.gap,
                        "create_at": addTime[k]
                    })
                }
                subJson.point.push({
                    "follower_num": userProfileJson.follower_num,
                    "rank": userEventJson.event.ranking.rank,
                    "next_rank": userEventJson.event.ranking.next_rank,
                    "point": userEventJson.event.ranking.point,
                    "gap": userEventJson.event.ranking.gap,
                    "create_at": analyze_time
                })
                eventList[i].jsonData.data.push(subJson)
            }

        }
        console.log('------------')

    }
    console.log(' End  - get update data')

    console.log('Start - update')
    for (let i = 0; i < eventList.length; i++) {
        let updateId = await updateFirebase(eventList[i].id, eventList[i].jsonData)
        if (updateId != "update") {
            console.log(eventList[i].id)
            console.error("Error writing document: ", updateId);
        } else {
            console.log(eventList[i].id + ':' + updateId)
        }

    }
    console.log(' End  - update')

    console.log(' End  - function')
}
console.log('起動')

cron.schedule('0 0 0,0,1,7-23 * * *', () => {
    console.log('イベント情報更新開始')
    eventUpdate()
});

function getEventData() {
    return new Promise(resolve => {
        let db = admin.firestore()
        db.collection('event')
            .get()
            .then((querySnapshot) => {
                resolve(querySnapshot)
            })
    });
}

function getShowroomData(baseUrl, parameter) {
    return new Promise(resolve => {
        request('GET', baseUrl + parameter).done((res) => {
            resolve(res)
        });
    });
}

function updateFirebase(updateId, updateData) {
    return new Promise((resolve, reject) => {
        let db = admin.firestore()
        db.collection('event')
            .doc(updateId)
            .set(updateData)
            .then(function () {
                resolve('update')
            })
            .catch(function (error) {
                reject(error)
            });
    });
}