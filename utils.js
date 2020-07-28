const axios = require("axios");
const crypto = require("crypto");
const chalk = require("chalk");

const BASE_URL = "https://api.binance.com/api/v3";
const API_KEY = "UFXm47ecR6IaD2hMlFDclbNxQF9dVPVnssYFAm99VUtoPI65EYgAaOai4nuEwHSC";
const API_SECRET = "6rVeGsEWErt0Vbfb8DeMYn9xwPOnNfa8zdshB49lMfq4tnnfnq2KXOfDwpGxDlb5";

async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
}

function mergeObjectsInUnique(array, property) {
    const newArray = new Map();

    array.forEach((item) => {
        const propertyValue = item[property];
        newArray.has(propertyValue)
            ? newArray.set(propertyValue, { ...item, ...newArray.get(propertyValue) })
            : newArray.set(propertyValue, item);
    });

    return Array.from(newArray.values());
}

function timeout(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function countDecimals(value) {
    if (Math.floor(value) === value) return 0;
    return value.toString().split(".")[1].length || 0;
}

async function getRequest(route, params, isSigned = false, headers = {}) {
    const HMAC_KEY = crypto.createHmac("sha256", API_SECRET).update(params).digest("hex");

    try {
        const { data } = await axios.get(`${BASE_URL}/${route}?${params}${isSigned ? `&signature=${HMAC_KEY}` : ""}`, {
            headers: { ...headers, "X-MBX-APIKEY": API_KEY },
        });
        return data;
    } catch (err) {
        const errMsg = err.response ? err.response.data.msg : err;
        console.log(chalk.red(`Request ${route} ${params} - ${errMsg}`));
        return Promise.reject(errMsg);
    }
}

async function postRequest(route, params, isSigned = false, headers = {}) {
    const HMAC_KEY = crypto.createHmac("sha256", API_SECRET).update(params).digest("hex");

    try {
        const response = await axios.post(`${BASE_URL}/${route}?${params}${isSigned ? `&signature=${HMAC_KEY}` : ""}`, null, {
            headers: { ...headers, "X-MBX-APIKEY": API_KEY },
        });
        return response;
    } catch (err) {
        const errMsg = err.response.data.msg;
        console.log(chalk.red(`Request ${route} ${params} - ${errMsg}`));
        return Promise.reject(errMsg);
    }
}

async function deleteRequest(route, params, isSigned = false, headers = {}) {
    const HMAC_KEY = crypto.createHmac("sha256", API_SECRET).update(params).digest("hex");

    try {
        const response = await axios.delete(`${BASE_URL}/${route}?${params}${isSigned ? `&signature=${HMAC_KEY}` : ""}`, {
            headers: { ...headers, "X-MBX-APIKEY": API_KEY },
        });
        return response;
    } catch (err) {
        const errMsg = err.response.data.msg;
        console.log(chalk.red(`Request ${route} ${params} - ${errMsg}`));
        return Promise.reject(errMsg);
    }
}

module.exports = {
    asyncForEach,
    mergeObjectsInUnique,
    timeout,
    countDecimals,
    getRequest,
    postRequest,
    deleteRequest,
};
